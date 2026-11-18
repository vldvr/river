import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { createGunzip } from 'node:zlib'

const run = promisify(execFile)

export interface ReleaseAsset {
  name: string
  size: number
  digest?: string | null
  browser_download_url: string
}

type FetchAsset = (url: string) => Promise<Response>

async function download(asset: ReleaseAsset, file: string, fetchAsset: FetchAsset) {
  const res = await fetchAsset(asset.browser_download_url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body as ReadableStream), createWriteStream(file))
  if ((await stat(file)).size !== asset.size) throw new Error('Неполная загрузка')
  if (asset.digest) {
    const hash = createHash('sha256')
    await pipeline(createReadStream(file), hash)
    if (`sha256:${hash.digest('hex')}` !== asset.digest) throw new Error('Контрольная сумма не совпала')
  }
}

async function verify(bundle: string, version: string) {
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', '=identifier "com.vldvr.river"', bundle])
  const plist = join(bundle, 'Contents', 'Info.plist')
  const { stdout } = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist])
  if (stdout.trim() !== version) throw new Error('Версия приложения не совпала')
}

/** Готовим отдельную копию. Установленное приложение может продолжать игру до выхода. */
export async function prepareMacUpdate(
  installed: string, dir: string, current: string, version: string, arch: string,
  assets: ReleaseAsset[], fetchAsset: FetchAsset,
): Promise<string> {
  const stem = `River-${version}-mac-${arch}`
  const zip = assets.find((a) => a.name === `${stem}.zip`)
  if (!zip) throw new Error('Нет сборки для этого Mac')
  // При пересборке того же тега старый патч не должен подменить новый полный архив.
  const zipHash = zip.digest?.match(/^sha256:([0-9a-f]{64})$/)?.[1]
  const patch = zipHash && assets.find((a) => a.name === `${stem}-from-${current}-${zipHash}.rsync.gz`)
  const fresh = join(dir, 'River.app')
  const payload = join(dir, 'download')
  if (patch && patch.size < zip.size && /^sha256:[0-9a-f]{64}$/.test(patch.digest ?? '')) {
    const batch = join(dir, 'update.rsync')
    try {
      await download(patch, payload, fetchAsset)
      await pipeline(createReadStream(payload), createGunzip(), createWriteStream(batch))
      await run('/usr/bin/ditto', [installed, fresh])
      await run('/usr/bin/rsync', ['-rlptc', '--delete', `--read-batch=${batch}`, `${fresh}/`])
      await verify(fresh, version)
      return fresh
    } catch (error) {
      console.warn('Не удалось применить патч, скачиваем полный архив', error)
      await rm(fresh, { recursive: true, force: true })
    } finally {
      await rm(batch, { force: true })
      await rm(payload, { force: true })
    }
  }
  await download(zip, payload, fetchAsset)
  await run('/usr/bin/ditto', ['-x', '-k', payload, dir])
  await rm(payload)
  await verify(fresh, version)
  return fresh
}
