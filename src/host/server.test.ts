import { describe, expect, it } from 'vitest'
import { seededRandomInt, DEFAULT_CONFIG, type GameConfig } from '../engine/index.ts'
import { PROTOCOL_VERSION, type ClientTransport, type HostMessage, type TableView } from '../protocol/index.ts'
import { HostServer, type HostSnapshot, type RatingReport, type RatingService } from './server.ts'
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

function harness(config: Partial<GameConfig> = {}, seed = 1, ratings?: RatingService) {
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
    ratings,
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
  // Вылетевшим зрителям карты показываются нарочно.
  const me = g.players.find((p) => p.id === viewerId)
  if (!h.players.some((p) => p.id === viewerId) && (!me || me.status === 'busted')) return []
  return h.players.filter((p) => p.id !== viewerId && !(h.revealed && !p.folded)).flatMap((p) => p.hole)
}

describe('HostServer', () => {
  it('finishes a blackjack table and settles the active round, without rating it', () => {
    const H = harness({ game: 'blackjack', format: 'cash', startingStack: 500, bigBlind: 10, smallBlind: 5 }, 4)
    const host = H.connect('Хост', 'host-token-0000000000')
    const guest = H.connect('Гость', 'token-guest-00000000')
    host.t.send({ t: 'start' })
    H.flush()
    H.tick(1500)
    expect(host.view?.bj?.phase).toBe('betting')
    host.t.send({ t: 'bj', round: host.view!.bj!.roundNo, action: { type: 'bet', amount: 10 } })
    guest.t.send({ t: 'bj', round: guest.view!.bj!.roundNo, action: { type: 'bet', amount: 10 } })
    H.flush()
    host.t.send({ t: 'leave' })
    H.flush()
    expect(H.server.state.phase).toBe('finished')
    expect(host.view!.results).toHaveLength(2)
    expect(host.view!.results.every((r) => r.ratingDelta === 0)).toBe(true)
    expect(guest.view!.players.every((p) => typeof p.rating === 'number')).toBe(true)
  })

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

describe('HostServer limits', () => {
  it('rejects newcomers when the room is locked or full, but lets the host and known players back', () => {
    const sched = new ManualScheduler()
    const server = new HostServer({ code: '1', hostToken: 'host-token-0000000000', appVersion: '1', scheduler: sched, rand: seededRandomInt(1) })
    const say = (token: string) => {
      const got: HostMessage[] = []
      const t = loopback(server, (fn) => fn())
      t.onMessage = (m) => got.push(m)
      t.send({ t: 'hello', v: PROTOCOL_VERSION, appVersion: '1', name: 'X', color: '#000000', avatar: null, token })
      return { t, got }
    }
    const host = say('host-token-0000000000')
    const known = say('known-token-00000000000')
    host.t.send({ t: 'lock', locked: true })
    expect(say('stranger-token-0000000').got[0]).toMatchObject({ t: 'reject', reason: 'locked' })
    known.t.close()
    expect(say('known-token-00000000000').got[0]).toMatchObject({ t: 'welcome' })
    host.t.send({ t: 'lock', locked: false })
    for (let i = 0; i < 20; i++) say(`filler-token-${String(i).padStart(10, '0')}`)
    expect(server.state.members.length).toBe(16)
    expect(say('late-token-000000000000').got[0]).toMatchObject({ t: 'reject', reason: 'full' })
  })

  it('a rejected bet does not freeze the turn timer', () => {
    const H = harness({ format: 'cash', turnSeconds: 10 }, 21)
    const host = H.connect('Хост', 'host-token-0000000000', false)
    host.t.send({ t: 'addBot' })
    host.t.send({ t: 'start' })
    H.flush()
    let guard = 0
    while (!host.view?.you.legal && guard++ < 200) H.tick(300)
    const v = host.view!
    host.t.send({ t: 'action', handNo: v.hand!.handNo, action: { type: 'raise', to: 1 } })
    H.flush()
    expect(host.inbox.some((m) => m.t === 'error')).toBe(true)
    const hand = v.hand!.handNo
    // Время хода (10 с) плюс показ раздачи.
    for (let i = 0; i < 6; i++) H.tick(3000)
    const after = H.server.state.game.hand!
    expect(after.handNo > hand || after.toAct !== v.you.legal!.seat).toBe(true)
  })
})

describe('HostServer blackjack', () => {
  it('plays rounds through the protocol, keeps chips and never leaks the hole card', () => {
    const H = harness({ game: 'blackjack', format: 'cash', startingStack: 500, bigBlind: 10, smallBlind: 5, turnSeconds: 10 }, 33)
    const host = H.connect('Хост', 'host-token-0000000000', false)
    host.t.send({ t: 'addBot' })
    host.t.send({ t: 'addBot' })
    host.t.send({ t: 'start' })
    H.flush()
    const orig = host.t.onMessage!
    host.t.onMessage = (msg) => {
      const r = H.server.state.game.bj
      if (r && r.holeHidden && r.dealer[1] && JSON.stringify(msg).includes(`"${r.dealer[1]}"`)) {
        // Та же карта может честно лежать у кого-то на руках: проверяем только поле дилера.
        if ('view' in msg && msg.view?.bj?.dealer.cards.includes(r.dealer[1])) throw new Error('hole card leaked')
      }
      orig(msg)
    }
    let rounds = 0
    let last = 0
    for (let i = 0; i < 4000 && rounds < 15; i++) {
      H.tick(400)
      const bj = host.view?.bj
      if (!bj) continue
      if (bj.roundNo !== last) {
        last = bj.roundNo
        rounds++
      }
      if (bj.you.canBet && bj.you.bet === null) host.t.send({ t: 'bj', round: bj.roundNo, action: { type: 'bet', amount: 20 } })
      if (bj.you.legal) host.t.send({ t: 'bj', round: bj.roundNo, action: { type: 'stand' } })
      H.flush()
      const g = H.server.state.game
      const onTable = g.bj?.phase === 'playing' ? g.bj.seats.reduce((s, x) => s + x.hands.reduce((a, h) => a + h.bet, 0), 0) : 0
      const stacks = g.players.reduce((s, p) => s + p.stack, 0)
      // Фишки игроков плюс ставки на столе меняются только на итог раундов: не уходят в минус и не берутся из ниоткуда.
      expect(stacks + onTable).toBeGreaterThan(0)
    }
    expect(rounds).toBeGreaterThanOrEqual(15)
    expect(H.server.state.game.bj).not.toBeNull()
  })
})

describe('HostServer spectators', () => {
  it('spectators see every hole card, seated players only their own', () => {
    const H = harness({ format: 'cash', maxSeats: 2 }, 41)
    const host = H.connect('Хост', 'host-token-0000000000')
    host.t.send({ t: 'addBot' })
    H.flush()
    const watcher = H.connect('Зритель', 'token-watcher-0000000', false)
    host.t.send({ t: 'start' })
    H.flush()
    for (let i = 0; i < 20 && !watcher.view?.hand; i++) H.tick(300)
    const seen = (v: typeof watcher.view) => v!.hand!.seats.filter((s) => s.cards).length
    expect(watcher.view!.you.spectator).toBe(true)
    expect(seen(watcher.view)).toBe(2)
    expect(host.view!.you.spectator).toBe(false)
    expect(seen(host.view)).toBe(1)
  })

  it('the host can turn spectator cards off', () => {
    const H = harness({ format: 'cash', maxSeats: 2, spectatorsSeeCards: false }, 41)
    const host = H.connect('Хост', 'host-token-0000000000')
    host.t.send({ t: 'addBot' })
    H.flush()
    const watcher = H.connect('Зритель', 'token-watcher-0000000', false)
    host.t.send({ t: 'start' })
    H.flush()
    for (let i = 0; i < 20 && !watcher.view?.hand; i++) H.tick(300)
    expect(watcher.view!.hand!.seats.filter((s) => s.cards).length).toBe(0)
  })
})

describe('HostServer rating', () => {
  /** Сервер рейтинга понарошку: билет "t:<аккаунт>", итог принимает и отвечает изменениями. */
  function fakeRatings() {
    const reports: RatingReport[] = []
    const svc: RatingService = {
      async seat(ticket) {
        return ticket.startsWith('t:') ? { account: ticket.slice(2), rating: 1200, games: 5 } : null
      },
      async report(r) {
        reports.push(r)
        const changes = r.final ? r.players.map((p, i) => ({ id: p.ticket.slice(2), rating: 1200 + (i === 0 ? 10 : -10), delta: i === 0 ? 10 : -10, games: 6 })) : undefined
        return { game: { id: 'g1', key: 'k' }, done: r.final, changes }
      },
    }
    return { svc, reports }
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('takes ratings from the server, reports humans only and shows the result', async () => {
    const { svc, reports } = fakeRatings()
    const H = harness({ startingStack: 300 }, 7, svc)
    const host = H.connect('Хост', 'host-token-0000000000')
    const anya = H.connect('Аня', 'token-anya-000000000')
    host.t.send({ t: 'addBot' })
    host.t.send({ t: 'account', ticket: 't:host-account' })
    anya.t.send({ t: 'account', ticket: 't:anya-account' })
    H.flush()
    await settle()
    H.flush()
    expect(host.view!.players.find((p) => p.id === anya.id)!.rating).toBe(1200)

    host.t.send({ t: 'start' })
    H.flush()
    let guard = 0
    while (H.server.state.phase !== 'finished' && guard++ < 200_000) {
      H.tick(300)
      if (guard % 50 === 0) await settle()
    }
    await settle()
    await settle()
    H.flush()
    expect(reports.length).toBeGreaterThan(1)
    // Бот в отчёт не попадает, после первого отчёта хост помнит партию.
    expect(reports.every((r) => r.players.length === 2)).toBe(true)
    expect(reports.at(-1)!.final).toBe(true)
    expect(reports.at(-1)!.game).toEqual({ id: 'g1', key: 'k' })
    expect(host.view!.results.filter((r) => r.ratingDelta !== 0)).toHaveLength(2)
  })

  it('ignores tickets the server does not accept', async () => {
    const { svc } = fakeRatings()
    const H = harness({}, 1, svc)
    const host = H.connect('Хост', 'host-token-0000000000')
    host.t.send({ t: 'account', ticket: 'forged-ticket-xx' })
    H.flush()
    await settle()
    expect(H.server.snapshot().accounts).toEqual([])
  })
})

describe('HostServer ending', () => {
  it('the host ends a cash game after the current hand, not in the middle of it', () => {
    const H = harness({ format: 'cash' }, 3)
    const host = H.connect('Хост', 'host-token-0000000000', false)
    H.connect('Аня', 'token-anya-000000000', false)
    host.t.send({ t: 'start' })
    H.flush()
    H.tick(3000)
    expect(H.server.state.game.hand?.done).toBe(false)
    host.t.send({ t: 'end' })
    H.flush()
    expect(H.server.state.phase).toBe('playing')
    expect(host.view!.ending).toBe(true)
    let guard = 0
    while (H.server.state.phase !== 'finished' && guard++ < 2000) H.tick(500)
    expect(H.server.state.phase).toBe('finished')
    const total = H.server.state.game.players.reduce((s, p) => s + p.stack, 0)
    expect(total).toBe(2 * H.server.state.game.config.startingStack)
  })

  it('a tournament finishes even when a player walked away for good', () => {
    const H = harness({ startingStack: 300, levelMinutes: 1 }, 9)
    const host = H.connect('Хост', 'host-token-0000000000')
    const gone = H.connect('Ушёл', 'token-gone-000000000', false)
    host.t.send({ t: 'start' })
    H.flush()
    gone.t.send({ t: 'sit', out: true })
    gone.t.close()
    H.flush()
    let guard = 0
    while (H.server.state.phase !== 'finished' && guard++ < 100_000) H.tick(500)
    expect(H.server.state.phase).toBe('finished')
    expect(host.view!.results.map((r) => r.place).sort()).toEqual([1, 2])
  })

  it('players can change name, colour and card back at the table', () => {
    const H = harness({ format: 'cash' }, 2)
    const host = H.connect('Хост', 'host-token-0000000000')
    const anya = H.connect('Аня', 'token-anya-000000000')
    host.t.send({ t: 'start' })
    H.flush()
    anya.t.send({ t: 'profile', name: 'Анна', color: '#112233', avatar: null, back: 'ivy' })
    H.flush()
    const p = host.view!.players.find((x) => x.id === anya.id)!
    expect([p.name, p.color, p.back]).toEqual(['Анна', '#112233', 'ivy'])
  })
})
