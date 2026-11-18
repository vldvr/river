// Included only in the isolated native smoke-test build.
import { resumeGame, savedGame, send } from './net/connection'
import { useApp } from './store/app'

async function waitFor(label: string, condition: () => boolean | Promise<boolean>, ms = 45000) {
  const until = Date.now() + ms
  while (!await condition()) {
    if (Date.now() > until) throw new Error('Timed out waiting for ' + label)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function report(message: string) {
  await fetch('http://127.0.0.1:47983/result', { method: 'POST', body: message })
}

async function testHost() {
  const snap = savedGame()
  const { profile, settings } = useApp.getState()
  if (!snap || profile.name !== 'Проверка Ривера' || profile.token !== 'host-token-for-release-test' ||
      profile.secret !== '0123456789ABCDEFGHJK' || settings.felt !== 'wine' || snap.phase !== 'playing') {
    throw new Error('Legacy profile, account, settings or active hand missing')
  }
  await resumeGame()
  await waitFor('guest at table', () => useApp.getState().view?.players.some(p => p.name === 'Гость проверки' && p.connected) === true)
  const ipc = (window as unknown as { __TAURI_INTERNALS__: { invoke(cmd: string, args: object): Promise<unknown> } }).__TAURI_INTERNALS__
  // A programmatic minimize gets stuck mid-animation on macOS, so the tester presses Cmd+M.
  await report('waiting-minimize')
  await waitFor('native window to minimize', async () => Boolean(await ipc.invoke('plugin:window|is_minimized', { label: 'main' })), 180000)
  await report('minimized')
  send({ t: 'pause', paused: false })
  send({ t: 'end' })
}
void testHost().catch(e => report(String(e)))
