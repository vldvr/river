// Две копии приложения на одной машине: хост создаёт комнату, гость входит по коду
// через настоящие публичные релеи. Перед запуском: npm run build.
// node e2e/two-players.mjs
import { _electron as electron } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'test-results/two-players')
mkdirSync(out, { recursive: true })

async function launch(profile, name, color) {
  const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, RIVER_PROFILE: profile } })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(
    ([n, c]) => {
      localStorage.clear()
      localStorage.setItem('river.profile', JSON.stringify({ name: n, color: c, avatar: null, token: '' }))
    },
    [name, color],
  )
  await win.reload()
  await win.waitForSelector('text=Создать игру')
  win.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes('trystero')) console.log(`[${name}] ${m.type()}: ${m.text()}`)
  })
  return { app, win }
}

const shot = (win, file) => win.screenshot({ path: resolve(out, file) })

const host = await launch('e2e-host', 'Влад', '#e0a458')
const guest = await launch('e2e-guest', 'Аня', '#5fb3c9')

await host.win.click('text=Создать игру')
await host.win.waitForSelector('.lobby__code')
const code = (await host.win.textContent('.lobby__code')).replace(/\D/g, '')
console.log('код комнаты', code)

const t0 = Date.now()
await guest.win.click('.code__input')
await guest.win.keyboard.type(code)
await guest.win.keyboard.press('Enter')
const joined = await Promise.race([
  guest.win.waitForSelector('.lobby', { timeout: 45_000 }).then(() => 'lobby'),
  guest.win.waitForSelector('.form-error', { timeout: 45_000 }).then(async () => 'error: ' + (await guest.win.textContent('.form-error'))),
]).catch((e) => 'timeout: ' + e.message)
console.log('гость:', joined, `за ${((Date.now() - t0) / 1000).toFixed(1)} с`)
await shot(guest.win, '1-guest-lobby.png')
await shot(host.win, '1-host-lobby.png')

if (joined === 'lobby') {
  await host.win.click('button:has-text("Бот")')
  await host.win.waitForTimeout(400)
  await host.win.click('text=Начать игру')

  // Оба игрока чекают или коллируют, пока не сыграется несколько раздач.
  const play = async (p, label) => {
    for (let i = 0; i < 200; i++) {
      const bar = await p.win.$('.actionbar')
      if (bar) {
        const check = await p.win.$('.actionbar button:has-text("Чек")')
        if (check) await check.click()
        else await p.win.click('.actionbar button:has-text("Колл")').catch(() => {})
      }
      await p.win.waitForTimeout(300)
      const hand = await p.win.evaluate(() => document.querySelector('.topbar__blinds') !== null)
      if (!hand) continue
    }
    console.log(label, 'доиграл')
  }
  const shots = (async () => {
    for (let i = 0; i < 6; i++) {
      await host.win.waitForTimeout(9000)
      await shot(host.win, `2-host-${i}.png`)
      await shot(guest.win, `2-guest-${i}.png`)
    }
  })()
  await Promise.all([play(host, 'хост'), play(guest, 'гость'), shots])
  const log = await guest.win.evaluate(() => [...document.querySelectorAll('.logline')].map((l) => l.textContent).slice(-12))
  console.log('лента у гостя:', log)
}

await host.app.close()
await guest.app.close()
