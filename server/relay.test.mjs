import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createRelay } from './relay.mjs'

let relay
let url
const SECRET = 'a'.repeat(64)

beforeEach(async () => {
  relay = await createRelay({ port: 0, host: '127.0.0.1', log: () => {} })
  url = `ws://127.0.0.1:${relay.port}/ws`
})
afterEach(() => relay.close())

/** Клиент, который складывает входящие кадры и ждёт нужный. */
function client(query) {
  const ws = new WebSocket(`${url}?${query}`)
  const inbox = []
  const waiters = []
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString())
    inbox.push(msg)
    for (const w of [...waiters]) if (w.test(msg)) {
      waiters.splice(waiters.indexOf(w), 1)
      w.resolve(msg)
    }
  })
  const closed = new Promise((r) => ws.on('close', (code) => r(code)))
  return {
    ws,
    inbox,
    closed,
    next(test) {
      const hit = inbox.find(test)
      if (hit) return Promise.resolve(hit)
      return new Promise((resolve) => waiters.push({ test, resolve }))
    },
    send: (obj) => ws.send(JSON.stringify(obj)),
  }
}

describe('relay', () => {
  it('forwards frames between a guest and the host', async () => {
    const host = client(`role=host&code=123456&secret=${SECRET}`)
    await host.next((m) => m.relay === 'hosting')
    const guest = client('role=guest&code=123456')
    await guest.next((m) => m.relay === 'joined')
    const open = await host.next((m) => m.t === 'open')

    guest.send({ t: 'hello', name: 'Аня' })
    const got = await host.next((m) => m.t === 'msg')
    expect(got.conn).toBe(open.conn)
    expect(JSON.parse(got.data)).toEqual({ t: 'hello', name: 'Аня' })

    host.send({ t: 'send', conn: open.conn, data: JSON.stringify({ t: 'welcome', you: 'x' }) })
    expect(await guest.next((m) => m.t === 'welcome')).toEqual({ t: 'welcome', you: 'x' })

    guest.ws.close()
    expect(await host.next((m) => m.t === 'close')).toEqual({ t: 'close', conn: open.conn })
  })

  it('tells a guest when there is no such room', async () => {
    const guest = client('role=guest&code=654321')
    expect(await guest.closed).toBe(4404)
  })

  it('does not let another host take a busy code, but lets the owner back', async () => {
    const host = client(`role=host&code=111111&secret=${SECRET}`)
    await host.next((m) => m.relay === 'hosting')
    const thief = client(`role=host&code=111111&secret=${'b'.repeat(64)}`)
    expect(await thief.closed).toBe(4409)

    const guest = client('role=guest&code=111111')
    await guest.next((m) => m.relay === 'joined')
    const again = client(`role=host&code=111111&secret=${SECRET}`)
    await again.next((m) => m.relay === 'hosting')
    expect(await host.closed).toBe(4410)
    expect(await guest.closed).toBe(4410)
  })

  it('closes guests when the host leaves and frees the code', async () => {
    const host = client(`role=host&code=222222&secret=${SECRET}`)
    await host.next((m) => m.relay === 'hosting')
    const guest = client('role=guest&code=222222')
    await guest.next((m) => m.relay === 'joined')
    host.ws.close()
    expect(await guest.closed).toBe(4410)
    await new Promise((r) => setTimeout(r, 30))
    expect(relay.rooms.size).toBe(0)
  })

  it('ignores host frames aimed at a connection that is not in its room', async () => {
    const a = client(`role=host&code=333333&secret=${SECRET}`)
    await a.next((m) => m.relay === 'hosting')
    const b = client(`role=host&code=444444&secret=${SECRET}`)
    await b.next((m) => m.relay === 'hosting')
    const guestB = client('role=guest&code=444444')
    await guestB.next((m) => m.relay === 'joined')
    const open = await b.next((m) => m.t === 'open')
    a.send({ t: 'send', conn: open.conn, data: '{"t":"evil"}' })
    await new Promise((r) => setTimeout(r, 80))
    expect(guestB.inbox.some((m) => m.t === 'evil')).toBe(false)
  })

  it('rejects malformed requests', async () => {
    expect(await client('role=guest&code=12').closed).toBe(4400)
    expect(await client('role=host&code=123456&secret=zz').closed).toBe(4400)
  })

  it('slows down an address that keeps guessing codes', async () => {
    for (let i = 0; i < 12; i++) expect(await client(`role=guest&code=${100000 + i}`).closed).toBe(4404)
    const host = client(`role=host&code=555555&secret=${SECRET}`)
    await host.next((m) => m.relay === 'hosting')
    expect(await client('role=guest&code=555555').closed).toBe(4429)
  })

  it('survives a garbage request line', async () => {
    const net = await import('node:net')
    await new Promise((resolve) => {
      const sock = net.connect(relay.port, '127.0.0.1', () => {
        sock.write('GET http://[bad HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
      })
      sock.on('close', resolve)
      sock.on('error', resolve)
      setTimeout(() => sock.destroy(), 300)
    })
    const host = client(`role=host&code=666666&secret=${SECRET}`)
    expect((await host.next((m) => m.relay === 'hosting')).code).toBe('666666')
  })

  it('behind a proxy keys the limiter on X-Real-IP, not on the proxy address', async () => {
    await relay.close()
    relay = await createRelay({ port: 0, host: '127.0.0.1', log: () => {}, trustProxy: true })
    url = `ws://127.0.0.1:${relay.port}/ws`
    const as = (ip, query) => {
      const ws = new WebSocket(`${url}?${query}`, { headers: { 'x-real-ip': ip } })
      return new Promise((r) => ws.on('close', (code) => r(code)))
    }
    for (let i = 0; i < 12; i++) expect(await as('10.0.0.66', `role=guest&code=${100000 + i}`)).toBe(4404)
    expect(await as('10.0.0.66', 'role=guest&code=100099')).toBe(4429)
    // Другой игрок за тем же nginx не страдает.
    expect(await as('10.0.0.7', 'role=guest&code=100099')).toBe(4404)
  })
})
