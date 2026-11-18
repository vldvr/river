import { app, net } from 'electron'
import electronUpdater from 'electron-updater'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, constants, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { prepareMacUpdate, type ReleaseAsset } from './macUpdate'
import type { UpdateState } from '../preload/api'

const REPO = 'vldvr/river'

interface Release {
  version: string
  url: string
  assets: ReleaseAsset[]
}

export function isPortable(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_DIR
}

/**
 * Установщик Windows обновляется сам из GitHub Releases. На Mac штатный Squirrel без
 * подписи Apple не работает, поэтому там готовим и подменяем River.app сами.
 * Портативная версия так не умеет: для неё только проверяем, вышла ли новая, и даём ссылку.
 */
export function initUpdater(send: (s: UpdateState) => void) {
  // Из лаунчера Sevensave игру обновляет сам лаунчер: подменять её папку изнутри нельзя.
  if (process.env.SEVENSAVE_LAUNCHER) return
  if (!app.isPackaged) return
  if (process.platform === 'darwin') {
    void macUpdate(send)
    return
  }
  if (isPortable() || process.platform !== 'win32') {
    void checkLatest(send)
    return
  }
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => send({ state: 'downloading', version: info.version }))
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => send({ state: 'error', message: err.message }))
  autoUpdater.checkForUpdates().catch(() => {})
}

export function installUpdate() {
  if (process.platform === 'darwin') {
    if (!macPending) return
    swapMacApp(true)
    app.quit()
    return
  }
  electronUpdater.autoUpdater.quitAndInstall(false, true)
}

async function fetchLatest(): Promise<Release | null> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { tag_name?: string; html_url?: string; assets?: Release['assets'] }
    const version = (data.tag_name ?? '').replace(/^v/, '')
    if (!version || !newer(version, app.getVersion())) return null
    return { version, url: data.html_url ?? `https://github.com/${REPO}/releases/latest`, assets: data.assets ?? [] }
  } catch {
    // нет сети: молчим
    return null
  }
}

async function checkLatest(send: (s: UpdateState) => void) {
  const rel = await fetchLatest()
  if (rel) send({ state: 'available', version: rel.version, url: rel.url })
}

// --- Mac ---

/** Скачанный и распакованный River.app, который подставим при выходе. */
let macPending: { app: string; target: string } | null = null
let macSwapped = false

async function macUpdate(send: (s: UpdateState) => void) {
  const dir = join(app.getPath('userData'), 'pending-update')
  await rm(dir, { recursive: true, force: true }).catch(() => {})
  const rel = await fetchLatest()
  if (!rel) return
  const fallback = () => send({ state: 'available', version: rel.version, url: rel.url })

  const target = await writableBundle()
  if (!target) return fallback()

  send({ state: 'downloading', version: rel.version })
  try {
    await mkdir(dir, { recursive: true })
    const fresh = await prepareMacUpdate(target, dir, app.getVersion(), rel.version, process.arch, rel.assets, (url) => net.fetch(url))
    macPending = { app: fresh, target }
    app.on('will-quit', () => swapMacApp(false))
    send({ state: 'ready', version: rel.version })
  } catch {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    fallback()
  }
}

/**
 * Путь к River.app, если его можно заменить. Из образа dmg, из карантинной копии macOS
 * (App Translocation) и из папки без прав на запись обновиться не получится.
 */
async function writableBundle(): Promise<string | null> {
  const bundle = dirname(dirname(dirname(app.getPath('exe'))))
  if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return null
  try {
    await access(dirname(bundle), constants.W_OK)
    await access(bundle, constants.W_OK)
    return bundle
  } catch {
    return null
  }
}

/** Отдельный процесс дождётся, пока мы выйдем, переложит новую версию на место старой и, если надо, запустит её. */
function swapMacApp(relaunch: boolean) {
  if (!macPending || macSwapped || !existsSync(macPending.app)) return
  macSwapped = true
  const script = `
pid="$1"; src="$2"; dst="$3"; relaunch="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
new="$dst.new"; old="$dst.old"
rm -rf "$new" "$old"
if /usr/bin/ditto "$src" "$new" && mv "$dst" "$old" && mv "$new" "$dst"; then
  rm -rf "$old"
else
  [ -d "$old" ] && [ ! -d "$dst" ] && mv "$old" "$dst"
  rm -rf "$new"
fi
/usr/bin/xattr -dr com.apple.quarantine "$dst" 2>/dev/null
rm -rf "$(dirname "$src")"
[ "$relaunch" = 1 ] && /usr/bin/open "$dst"
`
  spawn('/bin/sh', ['-c', script, 'sh', String(process.pid), macPending.app, macPending.target, relaunch ? '1' : '0'], {
    detached: true,
    stdio: 'ignore',
  }).unref()
}

function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}
