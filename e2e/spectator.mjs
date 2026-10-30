// Зритель видит карты всех игроков лицом вверх. node e2e/spectator.mjs (после npm run build)
import { _electron as electron } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'test-results/spectator')
mkdirSync(out, { recursive: true })

async function launch(profile, name, config) {
  const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, RIVER_PROFILE: profile } })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(
    ([n, c]) => {
      localStorage.clear()
      localStorage.setItem('river.profile', JSON.stringify({ name: n, color: '#e0a458', avatar: null, token: '' }))
      if (c) localStorage.setItem('river.lastConfig', JSON.stringify(c))
    },
    [name, config],
  )
  await win.reload()
  await win.waitForSelector('text=Создать игру')
  return { app, win }
}

const host = await launch('e2e-host', 'Хост', { game: 'holdem', format: 'cash', startingStack: 2000, smallBlind: 10, bigBlind: 20, maxSeats: 2, turnSeconds: 25, reentries: 1, spectatorsSeeCards: true })
const watcher = await launch('e2e-watch', 'Зритель', null)
await host.win.click('text=Создать игру')
await host.win.waitForSelector('.lobby__code')
const code = (await host.win.textContent('.lobby__code')).replace(/\D/g, '')
await host.win.click('button:has-text("Бот")')
await watcher.win.click('.code__input')
await watcher.win.keyboard.type(code)
await watcher.win.keyboard.press('Enter')
await watcher.win.waitForSelector('.lobby', { timeout: 30_000 })
await host.win.click('text=Начать игру')

let faceUp = 0
let stuck = 0
const t0 = Date.now()
while (Date.now() - t0 < 60_000) {
  const check = await host.win.$('.actionbar .act-btn:has-text("Чек")')
  if (check) await check.click().catch(() => {})
  else await host.win.click('.actionbar .act-btn:has-text("Колл")', { timeout: 200 }).catch(() => {})
  const cards = await watcher.win.$$eval('.seat-cards .pcard', (els) => els.map((c) => [c.getAttribute('aria-label'), c.style.transform]))
  for (const [label, t] of cards) {
    if (label && !label.includes('рубашкой')) {
      if (!t.includes('180')) faceUp++
      else stuck++
    }
  }
  await host.win.waitForTimeout(400)
}
await watcher.win.screenshot({ path: resolve(out, 'watcher.png') })
const spect = await watcher.win.textContent('.topbar__spect').catch(() => null)
console.log({ spect, faceUp, stuckSamples: stuck })
await host.app.close()
await watcher.app.close()
