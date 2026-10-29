// Проверка собранного приложения: запуск, игра с двумя ботами, несколько раздач, скриншоты.
// node e2e/smoke.mjs [--exe release/win-unpacked/River.exe]
import { _electron as electron } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'test-results/smoke')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const exeIdx = process.argv.indexOf('--exe')
const exe = exeIdx > 0 ? resolve(root, process.argv[exeIdx + 1]) : null

const fail = (msg) => {
  console.error('SMOKE FAIL:', msg)
  process.exitCode = 1
}

const app = await electron.launch({
  ...(exe ? { executablePath: exe, args: [] } : { args: [root] }),
  cwd: root,
  env: { ...process.env, RIVER_PROFILE: 'smoke' },
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

try {
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('river.profile', JSON.stringify({ name: 'Смоук', color: '#e0a458', avatar: null, token: '' }))
  })
  await win.reload()
  await win.waitForSelector('text=Создать игру', { timeout: 20_000 })
  console.log('версия:', await win.textContent('.home__foot'))
  await win.screenshot({ path: resolve(out, '1-home.png') })

  await win.click('text=Создать игру')
  await win.waitForSelector('.lobby__code')
  console.log('комната:', await win.textContent('.lobby__code'))
  await win.waitForTimeout(2500)
  const relay = (await win.$('.lobby__relay')) ? await win.textContent('.lobby__relay') : 'сервер комнат на связи'
  console.log('сервер комнат:', relay)
  await win.click('button:has-text("Бот")')
  await win.waitForTimeout(300)
  await win.click('button:has-text("Бот")')
  await win.waitForTimeout(400)
  await win.screenshot({ path: resolve(out, '2-lobby.png') })
  await win.click('text=Начать игру')

  const until = Date.now() + 60_000
  let shots = 0
  while (Date.now() < until) {
    const check = await win.$('.actionbar .act-btn:has-text("Чек")')
    if (check) await check.click().catch(() => {})
    else await win.click('.actionbar .act-btn:has-text("Колл")', { timeout: 200 }).catch(() => {})
    if (Date.now() > until - 60_000 + 12_000 * (shots + 1) && shots < 4) await win.screenshot({ path: resolve(out, `3-table-${++shots}.png`) })
    await win.waitForTimeout(300)
  }
  await win.keyboard.press('KeyT')
  await win.click('.side button:has-text("Раздачи")')
  await win.waitForTimeout(400)
  const hands = await win.$$eval('.loghand', (els) => els.length)
  console.log('сыграно раздач:', hands)
  await win.screenshot({ path: resolve(out, '4-history.png') })
  if (hands < 2) fail(`слишком мало раздач: ${hands}`)
} catch (e) {
  await win.screenshot({ path: resolve(out, 'error.png') }).catch(() => {})
  fail(e instanceof Error ? e.message : String(e))
}

const real = errors.filter((e) => !/Download the React DevTools/.test(e))
if (real.length) {
  console.log('ошибки в окне:', real.slice(0, 10))
  fail('в консоли окна были ошибки')
}
await app.close()
