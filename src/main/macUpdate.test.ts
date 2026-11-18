import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareMacUpdate, type ReleaseAsset } from './macUpdate'

describe.skipIf(process.platform !== 'darwin')('macOS update', () => {
  let dir: string
  let installed: string
  let patch: ReleaseAsset
  let zip: ReleaseAsset
  const payloads = new Map<string, Buffer>()

  async function asset(name: string): Promise<ReleaseAsset> {
    const bytes = await readFile(join(dir, name))
    payloads.set(name, bytes)
    return { name, size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), browser_download_url: name }
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'river-update-test-'))
    const unchanged = randomBytes(128 * 1024)
    for (const version of ['1.0.0', '1.1.0']) {
      const bundle = join(dir, version, 'River.app')
      const contents = join(bundle, 'Contents')
      await mkdir(join(contents, 'MacOS'), { recursive: true })
      await mkdir(join(contents, 'Resources'))
      await copyFile('/bin/echo', join(contents, 'MacOS', 'River'))
      await writeFile(join(contents, 'Resources', 'deck'), unchanged)
      await writeFile(join(contents, 'Resources', version), version)
      await writeFile(join(contents, 'Info.plist'), `<plist version="1.0"><dict>
        <key>CFBundleIdentifier</key><string>com.vldvr.river</string>
        <key>CFBundleExecutable</key><string>River</string>
        <key>CFBundlePackageType</key><string>APPL</string>
        <key>CFBundleShortVersionString</key><string>${version}</string>
      </dict></plist>`)
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { stdio: 'pipe' })
      execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', bundle, join(dir, `River-${version}-mac-arm64.zip`)])
    }
    installed = join(dir, '1.0.0', 'River.app')
    zip = await asset('River-1.1.0-mac-arm64.zip')
    const patchName = `River-1.1.0-mac-arm64-from-1.0.0-${zip.digest!.slice(7)}.rsync.gz`
    execFileSync('/bin/bash', ['tools/make-mac-patch.sh', join(dir, 'River-1.0.0-mac-arm64.zip'),
      join(dir, 'River-1.1.0-mac-arm64.zip'), join(dir, patchName)])
    patch = await asset(patchName)
  })

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  async function stage(current: string, assets: ReleaseAsset[], failPatch = false) {
    const get = vi.fn(async (name: string) => {
      const bytes = payloads.get(name)!
      return new Response(new Uint8Array(failPatch && name === patch.name ? Buffer.alloc(bytes.length) : bytes))
    })
    const staging = await mkdtemp(join(dir, 'staging-'))
    const app = await prepareMacUpdate(installed, staging, current, '1.1.0', 'arm64', assets, get)
    expect(await readFile(join(app, 'Contents/Resources/1.1.0'), 'utf8')).toBe('1.1.0')
    await expect(readFile(join(app, 'Contents/Resources/1.0.0'))).rejects.toThrow()
    expect(await readFile(join(installed, 'Contents/Resources/1.0.0'), 'utf8')).toBe('1.0.0')
    return get.mock.calls.map(([name]) => name)
  }

  it('downloads only the matching patch and leaves the installed bundle intact', async () => {
    expect(await stage('1.0.0', [patch, zip])).toEqual([patch.name])
  })

  it('downloads the ZIP after a damaged patch', async () => {
    expect(await stage('1.0.0', [patch, zip], true)).toEqual([patch.name, zip.name])
  })

  it('ignores a patch left behind by an earlier build of the same tag', async () => {
    const stale = { ...patch, name: patch.name.replace(zip.digest!.slice(7), '0'.repeat(64)) }
    expect(await stage('1.0.0', [stale, zip])).toEqual([zip.name])
  })

  it('rejects a full archive with an incorrect digest', async () => {
    await expect(stage('1.0.0', [{ ...zip, digest: 'sha256:' + '0'.repeat(64) }])).rejects.toThrow('Контрольная сумма')
  })

  it('downloads only the ZIP for a skipped release', async () => {
    expect(await stage('0.9.0', [patch, zip])).toEqual([zip.name])
  })
})
