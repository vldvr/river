import { describe, expect, it } from 'vitest'
import { seededRandomInt, DEFAULT_CONFIG, type GameConfig } from '../engine/index.ts'
import { PROTOCOL_VERSION, type ClientTransport, type HostMessage, type TableView } from '../protocol/index.ts'
import { HostServer, type HostSnapshot } from './server.ts'
import { ManualScheduler } from './scheduler.ts'
import { loopback } from './loopback.ts'

interface TestClient {
  name: string
  token: string
  t: ClientTransport
  id: string | null
  view: TableView | null
  inbox: HostMessage[]
  auto: boolean
}

function harness(config: Partial<GameConfig> = {}, seed = 1) {
  const sched = new ManualScheduler()
  const queue: (() => void)[] = []
  const rand = seededRandomInt(seed)
  let snapshot: HostSnapshot | null = null
  const server = new HostServer({
    code: '123456',
    hostToken: 'host-token-0000000000',
    appVersion: '1.0.0',
    config: { ...DEFAULT_CONFIG, turnSeconds: 20, ...config },
    scheduler: sched,
    rand,
    onSnapshot: (s) => (snapshot = s),
  })
  const flush = () => {
    let guard = 0
    while (queue.length) {
      if (guard++ > 100_000) throw new Error('message storm')
      queue.shift()!()
    }
  }
  const deliver = (fn: () => void) => queue.push(fn)
  const clients: TestClient[] = []

  function connect(name: string, token: string, auto = true): TestClient {
    const c: TestClient = { name, token, t: loopback(server, deliver), id: null, view: null, inbox: [], auto }
    c.t.onMessage = (msg) => {
      c.inbox.push(msg)
      if (msg.t === 'welcome') c.id = msg.you
      if ('view' in msg && msg.view) c.view = msg.view
    }
    c.t.send({ t: 'hello', v: PROTOCOL_VERSION, appVersion: '1.0.0', name, color: '#aa8844', avatar: null, token })
    clients.push(c)
    flush()
    return c
  }

  /** Живые клиенты ходят случайно, когда видят свой ход. */
  function playClients() {
    for (const c of clients) {
      const v = c.view
      if (!c.auto || !v?.you.legal || !v.hand || v.paused) continue
      const la = v.you.legal
      const r = rand(10)
      const action =
        r < 2 && la.canRaise
          ? { type: 'raise' as const, to: Math.min(la.maxTo, la.minTo + rand(3) * v.blinds.bb) }
          : r < 3 && la.canRaise
            ? { type: 'allin' as const }
            : la.canCheck
              ? { type: 'check' as const }
              : r < 8
                ? { type: 'call' as const }
                : { type: 'fold' as const }
      c.t.send({ t: 'action', handNo: v.hand.handNo, action })
      c.view = { ...v, you: { ...v.you, legal: null } }
    }
    flush()
  }

  function tick(ms = 250) {
    sched.advance(ms)
    flush()
    playClients()
  }

  return { server, sched, clients, connect, flush, tick, getSnapshot: () => snapshot }
}

function secretCards(server: HostServer, viewerId: string): string[] {
  const g = server.state.game
  const h = g.hand
  if (!h) return []
  return h.players.filter((p) => p.id !== viewerId && !(h.revealed && !p.folded)).flatMap((p) => p.hole)
}

describe('HostServer', () => {
  it('plays a full tournament with humans and bots, never leaking hole cards', () => {
    const H = harness({ startingStack: 400, levelMinutes: 2 }, 42)
    const host = H.connect('Хост', 'host-token-0000000000')
    H.connect('Аня', 'token-anya-000000000')
    H.connect('Миша', 'token-misha-00000000')
    host.t.send({ t: 'addBot' })
    host.t.send({ t: 'addBot' })
    H.flush()
    expect(host.view!.players.filter((p) => p.seat !== null)).toHaveLength(5)

    // Проверка утечек: на каждое сообщение смотрим, нет ли в нём чужих закрытых карт.
    for (const c of H.clients) {
      const orig = c.t.onMessage!
      c.t.onMessage = (msg) => {
        const json = JSON.stringify(msg)
        for (const card of secretCards(H.server, c.id ?? '')) {
          if (json.includes(`"${card}"`)) throw new Error(`${c.name} saw ${card} in ${msg.t}`)
        }
        orig(msg)
      }
    }

    host.t.send({ t: 'start' })
    H.flush()
    let guard = 0
    while (H.server.state.phase !== 'finished' && guard++ < 200_000) H.tick(300)
    expect(H.server.state.phase).toBe('finished')
    const places = host.view!.results.map((r) => r.place).sort()
    expect(places).toEqual([1, 2, 3, 4, 5])
    expect(H.server.state.game.handNo).toBeGreaterThan(3)
  })

  it('auto-folds a player who does not act and sits them out after two misses', () => {
    const H = harness({ format: 'cash', turnSeconds: 10 }, 7)
    const host = H.connect('Хост', 'host-token-0000000000')
    const idle = H.connect('Соня', 'token-sonya-00000000', false)
    host.t.send({ t: 'addBot' })
    host.t.send({ t: 'start' })
    H.flush()
    let guard = 0
    while (guard++ < 5000) {
      H.tick(500)
      const me = idle.view?.players.find((p) => p.id === idle.id)
      if (me?.status === 'sittingOut') break
    }
    expect(idle.view!.players.find((p) => p.id === idle.id)!.status).toBe('sittingOut')
    expect(idle.inbox.some((m) => m.t === 'events' && m.events.some((e) => e.t === 'timeout'))).toBe(true)
  })

  it('lets a player reconnect to the same seat with the same token', () => {
    const H = harness({ format: 'cash' }, 3)
    const host = H.connect('Хост', 'host-token-0000000000')
    const a = H.connect('Лёша', 'token-lesha-00000000')
    host.t.send({ t: 'start' })
    H.flush()
    H.tick(3000)
    const seat = a.view!.players.find((p) => p.id === a.id)!.seat
    a.t.close()
    H.flush()
    expect(host.view!.players.find((p) => p.id === a.id)!.connected).toBe(false)
    const again = H.connect('Лёша', 'token-lesha-00000000')
    expect(again.id).toBe(a.id)
    expect(again.view!.players.find((p) => p.id === a.id)!.seat).toBe(seat)
    expect(host.view!.players.find((p) => p.id === a.id)!.connected).toBe(true)
  })

  it('rejects a client with another protocol version', () => {
    const H = harness()
    const c = H.connect('Хост', 'host-token-0000000000')
    const t = loopback(H.server, (fn) => fn())
    const got: HostMessage[] = []
    t.onMessage = (m) => got.push(m)
    t.send({ t: 'hello', v: PROTOCOL_VERSION + 1, appVersion: '9', name: 'X', color: '#000000', avatar: null, token: 'zzzzzzzzzzzzzzzzzzzz' })
    expect(got[0]).toMatchObject({ t: 'reject', reason: 'version', hostVersion: '1.0.0' })
    expect(c.view!.players).toHaveLength(1)
  })

  it('only the host can change settings or start', () => {
    const H = harness()
    H.connect('Хост', 'host-token-0000000000')
    const guest = H.connect('Гость', 'token-guest-00000000')
    guest.t.send({ t: 'start' })
    guest.t.send({ t: 'config', config: { ...DEFAULT_CONFIG, startingStack: 99999 } })
    H.flush()
    expect(H.server.state.phase).toBe('lobby')
    expect(H.server.state.game.config.startingStack).toBe(DEFAULT_CONFIG.startingStack)
  })

  it('restores from a snapshot paused and resumes play', () => {
    const H = harness({ format: 'cash' }, 11)
    const host = H.connect('Хост', 'host-token-0000000000')
    host.t.send({ t: 'addBot' })
    host.t.send({ t: 'addBot' })
    host.t.send({ t: 'start' })
    H.flush()
    for (let i = 0; i < 40; i++) H.tick(500)
    const snap = H.getSnapshot()!
    H.server.dispose()

    const sched = new ManualScheduler()
    const restored = new HostServer({ code: snap.code, hostToken: snap.hostToken, appVersion: '1.0.0', scheduler: sched, rand: seededRandomInt(5), restore: snap })
    expect(restored.state.paused).toBe(true)
    const q: (() => void)[] = []
    const t = loopback(restored, (fn) => q.push(fn))
    let view: TableView | null = null
    t.onMessage = (m) => {
      if ('view' in m) view = m.view
    }
    t.send({ t: 'hello', v: PROTOCOL_VERSION, appVersion: '1.0.0', name: 'Хост', color: '#aa8844', avatar: null, token: snap.hostToken })
    while (q.length) q.shift()!()
    expect(view!.paused).toBe(true)
    t.send({ t: 'pause', paused: false })
    while (q.length) q.shift()!()
    const before = restored.state.game.handNo
    for (let i = 0; i < 200; i++) {
      sched.advance(500)
      while (q.length) q.shift()!()
      const v = view as TableView | null
      if (v?.you.legal && v.hand) {
        t.send({ t: 'action', handNo: v.hand.handNo, action: v.you.legal.canCheck ? { type: 'check' } : { type: 'call' } })
        while (q.length) q.shift()!()
      }
    }
    expect(restored.state.game.handNo).toBeGreaterThan(before)
  })
})
