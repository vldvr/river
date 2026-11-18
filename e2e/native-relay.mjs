// Start with two isolated Electron players. Replace the host with the actual Tauri binary
// mid-hand, keeping its guest open. Observe the final result from the guest over the relay.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { createRelay } from '../server/relay.mjs'

const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'river-relay-qa-'))
const relay = await createRelay({ port: 47982, host: '127.0.0.1', log: () => {} })
let minimized = false, failure
const reports = createServer(async (req, res) => {
  let message = ''
  for await (const chunk of req) message += chunk
  if (message === 'minimized') minimized = true
  else if (message === 'waiting-minimize') console.log('WAITING: minimize the River Relay Test window (Cmd+M)')
  else failure = message
  res.writeHead(200, { 'access-control-allow-origin': '*' }).end()
})
reports.listen(47983, '127.0.0.1')
await once(reports, 'listening')

async function waitFor(label, test, ms = 60000) {
  const until = Date.now() + ms
  while (!await test()) {
    if (failure || Date.now() > until) throw new Error(failure || 'Timed out: ' + label)
    await new Promise(r => setTimeout(r, 150))
  }
}

const apps = new Set()
async function player(id, name) {
  const app = await electron.launch({ args: [root, '--user-data-dir=' + join(dir, id)], cwd: root, env: { ...process.env, RIVER_PROFILE: '' } })
  apps.add(app)
  const win = await app.firstWindow()
  // Stop this first launch from creating test accounts on the public server.
  await win.route('https://river.wkiseven.me/**', route => route.abort())
  await win.waitForSelector('.home')
  await win.evaluate(({ id, name }) => {
    localStorage.setItem('river.profile', JSON.stringify({ name, token: id + '-token-for-release-test',
      secret: id === 'host' ? '0123456789ABCDEFGHJK' : '0123456789ABCDEFGHJM' }))
    localStorage.setItem('river.settings', JSON.stringify({ felt: 'wine', reduceMotion: true }))
    localStorage.setItem('river.lastConfig', JSON.stringify({ turnSeconds: 8 }))
    localStorage.setItem('river.seenVersion', JSON.stringify('1.8.3'))
    localStorage.setItem('river.relay', 'ws://127.0.0.1:47982/ws')
  }, { id, name })
  await win.reload()
  return { app, win }
}
let native
try {
  const host = await player('host', 'Проверка Ривера')
  const guest = await player('guest', 'Гость проверки')
  const welcomes = []
  let finished, latestView, timedOut = false
  guest.win.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
    const msg = JSON.parse(String(payload))
    if (msg.view) latestView = msg.view
    if (msg.t === 'welcome') welcomes.push(msg)
    if (minimized && msg.events?.some(e => e.t === 'timeout')) timedOut = true
    if (minimized && msg.view?.phase === 'finished') finished = msg.view
  }))
  await host.win.getByRole('button', {name:'Создать игру'}).click()
  const code = (await host.win.locator('.lobby__code').innerText()).replace(/\D/g, '')
  await guest.win.locator('.code__input').fill(code)
  await guest.win.locator('.code__input').press('Enter')
  await waitFor('guest joins', () => welcomes.length === 1)
  await host.win.getByRole('button', {name:'Начать игру'}).click()
  await host.win.waitForFunction(() => JSON.parse(localStorage.getItem('river.snapshot') || 'null')?.phase === 'playing')
  await waitFor('visible hand on the guest', () => latestView?.phase === 'playing')
  const old = latestView
  await host.app.close()
  apps.delete(host.app)
  const profile = join(dir, 'host')
  // On macOS launch the bundle through LaunchServices, like a player does: a bare binary can't be minimized.
  native = process.platform === 'darwin'
    ? spawn('open', ['-W', '-n', '--env', 'RIVER_QA_PROFILE=' + profile, resolve(root, 'src-tauri/target/release/bundle/macos/River Relay Test.app')], { stdio: 'inherit' })
    : spawn(resolve(root, 'src-tauri/target/release/River.exe'), [], { env: { ...process.env, RIVER_QA_PROFILE: profile }, stdio: 'inherit' })
  native.on('error', e => { failure = e.message })
  native.on('exit', code => { if (!finished) failure = 'Native host exited: ' + code })
  await waitFor('guest reconnects to restored native host', () => welcomes.length > 1, 240000)
  const resumed = welcomes.at(-1)
  assert.equal(resumed.you, welcomes[0].you)
  assert.equal(resumed.view.code, code)
  assert.equal(resumed.view.handNo, old.handNo)
  for (const before of old.players) {
    const now = resumed.view.players.find(p => p.id === before.id)
    assert.equal(now.seat, before.seat)
    assert.equal(now.stack, before.stack)
  }
  await waitFor('timeout and final standings with host minimized', () => finished && timedOut, 240000)
  assert.equal(finished.results.length, 2)
  console.log('PASS: Electron data imported, guest reconnected to the same seat and stack, minimized native host timed out the turn and completed the game.')
} finally {
  if (native && native.exitCode === null && native.signalCode === null) {
    const closed = once(native, 'exit')
    if (process.platform === 'darwin') spawn('pkill', ['-f', 'River Relay Test.app/Contents/MacOS'])
    native.kill()
    await closed
  }
  for (const app of apps) await app.close()
  reports.close()
  await relay.close()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
}
