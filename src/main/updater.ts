import { app, net } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../preload/api'

const REPO = 'vldvr/river'

export function isPortable(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_DIR
}

/**
 * Установщик обновляется сам из GitHub Releases. Портативная версия так не умеет,
 * поэтому для неё только проверяем, вышла ли новая, и даём ссылку.
 */
export function initUpdater(send: (s: UpdateState) => void) {
  if (!app.isPackaged) return
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
  electronUpdater.autoUpdater.quitAndInstall(false, true)
}

async function checkLatest(send: (s: UpdateState) => void) {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    if (latest && newer(latest, app.getVersion())) {
      send({ state: 'available', version: latest, url: data.html_url ?? `https://github.com/${REPO}/releases/latest` })
    }
  } catch {
    // нет сети: молчим
  }
}

function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}
