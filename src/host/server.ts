import {
  addPlayer,
  applyAction,
  applyGameRatings,
  blindsForLevel,
  bjAllBet,
  bjBegin,
  bjApply,
  bjBet,
  bjBotAction,
  bjCanStart,
  bjCloseBets,
  bjLegalFor,
  bjMaxBet,
  bjMinBet,
  bjTotal,
  normalizeConfig,
  type BjAction,
  type BjGameEvent,
  type Card,
  canReenter,
  reentriesLeft,
  canStartHand,
  createGame,
  cryptoRandomInt,
  DEFAULT_CONFIG,
  EngineError,
  findPlayer,
  inCurrentHand,
  leave,
  legalFor,
  nextLevelAt,
  rebuy,
  seatedPlayers,
  setSittingOut,
  startNextHand,
  type ActionKind,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerAction,
  type RandomInt,
  type ShowdownHand,
} from '../engine/index.ts'
import {
  BETWEEN_HANDS_MS,
  batchDuration,
  configSchema,
  MAX_MEMBERS,
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type BjView,
  type HandView,
  type HostMessage,
  type Phase,
  type PlayerView,
  type TableView,
  type ViewEvent,
} from '../protocol/index.ts'
import { botDecision, BOT_NAMES } from './bot.ts'
import { realScheduler, type Scheduler } from './scheduler.ts'

export interface Link {
  send(msg: HostMessage): void
  close(): void
}

export interface Session {
  receive(raw: unknown): void
  detach(): void
}

interface Member {
  id: string
  token: string
  name: string
  color: string
  avatar: string | null
  isBot: boolean
  isHost: boolean
  link: Link | null
  ping: number | null
  missed: number
  leaving: boolean
  lastChat: number
  rating: number
  ratingGames: number
}

type LastAction = { kind: ActionKind | 'post' | 'allin'; amount: number }
type HostEvent = GameEvent | ViewEvent | BjGameEvent

export interface HostSnapshot {
  v: 1
  code: string
  hostToken: string
  phase: Phase
  game: GameState
  members: Omit<Member, 'link'>[]
  kicked: string[]
  locked: boolean
  seq: number
  shown: number[]
  showdown: ShowdownHand[] | null
  winners: number[]
  lastActions: [number, LastAction][]
  savedAt: number
}

export interface HostOptions {
  code: string
  hostToken: string
  appVersion: string
  config?: GameConfig
  scheduler?: Scheduler
  rand?: RandomInt
  onSnapshot?: (s: HostSnapshot) => void
  restore?: HostSnapshot
}

const BOT_COLORS = ['#7aa6c2', '#c27a7a', '#8fb57a', '#b59a6a', '#9a86c4', '#6fb3a8', '#c49a6c', '#a3a3a3', '#c47ab0']
const DISCONNECTED_TURN_MS = 10_000
/** Пауза между раундами блэкджека. */
const BJ_BETWEEN_MS = 2200
/** Сколько раундов подряд без ставки, прежде чем игрок «отошёл». */
const BJ_IDLE_ROUNDS = 3

export class HostServer {
  readonly code: string
  private readonly hostToken: string
  private readonly appVersion: string
  private readonly sched: Scheduler
  private readonly rand: RandomInt
  private readonly onSnapshot?: (s: HostSnapshot) => void

  private members = new Map<string, Member>()
  private game: GameState
  private phase: Phase = 'lobby'
  private paused = false
  private seq = 0
  /** Токены выгнанных. Кик закрывает соединение и этот токен; от нового токена защищает замок комнаты. */
  private kicked = new Set<string>()
  private locked = false
  private disposed = false

  private turn: { seat: number; startsAt: number; deadline: number; totalMs: number } | null = null
  private pausedRemaining: number | null = null
  private turnTimer: unknown = null
  private botTimer: unknown = null
  private nextHandTimer: unknown = null
  private nextHandAt: number | null = null

  private shown = new Set<number>()
  private showdown: ShowdownHand[] | null = null
  private winners: number[] = []
  private lastActions = new Map<number, LastAction>()

  constructor(opts: HostOptions) {
    this.code = opts.code
    this.hostToken = opts.hostToken
    this.appVersion = opts.appVersion
    this.sched = opts.scheduler ?? realScheduler
    this.rand = opts.rand ?? cryptoRandomInt
    this.onSnapshot = opts.onSnapshot
    this.game = createGame(opts.config ?? DEFAULT_CONFIG)

    const r = opts.restore
    if (r) {
      // Сохранение могло остаться от старой версии: недостающее берём по умолчанию.
      this.game = { ...r.game, bustCounter: r.game.bustCounter ?? 0, config: { ...DEFAULT_CONFIG, ...r.game.config } }
      this.game.ratingApplied ??= false
      for (const p of this.game.players) {
        p.bustSeq ??= null
        p.rating ??= 1000
        p.ratingGames ??= 0
        p.ratingDelta ??= 0
      }
      this.phase = r.phase
      this.seq = r.seq
      this.kicked = new Set(r.kicked)
      this.locked = r.locked
      this.shown = new Set(r.shown)
      this.showdown = r.showdown
      this.winners = r.winners
      this.lastActions = new Map(r.lastActions)
      for (const m of r.members) this.members.set(m.id, { ...m, rating: m.rating ?? 1000, ratingGames: m.ratingGames ?? 0, link: null })
      // После восстановления ждём, пока все вернутся: хост снимет паузу сам.
      this.paused = this.phase === 'playing'
      const r0 = this.game.bj
      if (this.paused && r0 && r0.phase !== 'done') {
        this.pausedRemaining = this.game.config.turnSeconds * 1000
        const seat = r0.phase === 'betting' ? -1 : (r0.toAct?.seat ?? -1)
        this.turn = { seat, startsAt: 0, deadline: 0, totalMs: this.pausedRemaining }
      } else if (this.paused && this.game.hand && !this.game.hand.done && this.game.hand.toAct !== null) {
        this.pausedRemaining = this.game.config.turnSeconds * 1000
        this.turn = { seat: this.game.hand.toAct, startsAt: 0, deadline: 0, totalMs: this.pausedRemaining }
      }
    }
  }

  // ───────────── Подключения ─────────────

  attach(link: Link): Session {
    let memberId: string | null = null
    return {
      receive: (raw) => {
        if (this.disposed) return
        const msg = parseClientMessage(raw)
        if (!msg) return
        if (memberId === null) {
          if (msg.t === 'hello') memberId = this.onHello(link, msg)
          return
        }
        const m = this.members.get(memberId)
        if (!m || m.link !== link) return
        try {
          this.onMessage(m, msg)
        } catch (err) {
          if (err instanceof EngineError) link.send({ t: 'error', message: err.message })
          else throw err
        }
      },
      detach: () => {
        if (memberId === null) return
        const m = this.members.get(memberId)
        if (!m || m.link !== link) return
        m.link = null
        m.ping = null
        if (this.turn && this.seatOf(m.id) === this.turn.seat && !this.paused) {
          const now = this.sched.now()
          if (this.turn.deadline - now > DISCONNECTED_TURN_MS) {
            this.turn.deadline = Math.max(this.turn.startsAt, now) + DISCONNECTED_TURN_MS
            this.armTurnTimer()
          }
        }
        this.broadcastView()
      },
    }
  }

  dispose() {
    this.disposed = true
    this.clearTimers()
    if (this.nextHandTimer !== null) this.sched.clearTimeout(this.nextHandTimer)
    for (const m of this.members.values()) {
      m.link?.send({ t: 'reject', reason: 'closed' })
      m.link?.close()
      m.link = null
    }
  }

  /** Завершает стол перед закрытием хостового процесса. */
  finishGame() {
    if (this.phase === 'playing') this.finish()
  }

  private onHello(link: Link, msg: Extract<ClientMessage, { t: 'hello' }>): string | null {
    if (msg.v !== PROTOCOL_VERSION) {
      link.send({ t: 'reject', reason: 'version', hostVersion: this.appVersion })
      link.close()
      return null
    }
    if (this.kicked.has(msg.token)) {
      link.send({ t: 'reject', reason: 'kicked' })
      link.close()
      return null
    }

    let m = [...this.members.values()].find((x) => x.token === msg.token)
    const isHostToken = msg.token === this.hostToken
    if (!m && !isHostToken && (this.locked || this.members.size >= MAX_MEMBERS)) {
      link.send({ t: 'reject', reason: this.locked ? 'locked' : 'full' })
      link.close()
      return null
    }
    if (m) {
      const old = m.link
      m.link = link
      if (old && old !== link) old.close()
      if (this.phase === 'lobby') {
        m.name = this.uniqueName(msg.name, m.id)
        m.color = msg.color
        if (msg.avatar !== m.avatar) {
          m.avatar = msg.avatar
          this.sendAvatar(m)
        }
        const gp = findPlayer(this.game, m.id)
        if (gp) gp.name = m.name
      }
    } else {
      m = {
        id: this.newId(),
        token: msg.token,
        name: this.uniqueName(msg.name, null),
        color: msg.color,
        avatar: msg.avatar,
        isBot: false,
        isHost: isHostToken,
        link,
        ping: null,
        missed: 0,
        leaving: false,
        lastChat: 0,
        rating: msg.rating ?? 1000,
        ratingGames: msg.ratingGames ?? 0,
      }
      this.members.set(m.id, m)
      this.trySeat(m)
      this.sendAvatar(m)
    }

    const avatars: Record<string, string> = {}
    for (const x of this.members.values()) if (x.avatar) avatars[x.id] = x.avatar
    link.send({ t: 'welcome', you: m.id, view: this.viewFor(m), avatars })
    this.broadcastEvents([{ t: 'joined', id: m.id, name: m.name }], m.id)
    this.maybeStartHand()
    this.save()
    return m.id
  }

  private trySeat(m: Member) {
    const g = this.game
    const canJoin =
      this.phase === 'lobby' || (this.phase === 'playing' && g.config.format === 'cash')
    if (!canJoin || seatedPlayers(g).length >= g.config.maxSeats) return
    try {
      addPlayer(g, { id: m.id, name: m.name, isBot: m.isBot, rating: m.rating, ratingGames: m.ratingGames })
    } catch (err) {
      if (!(err instanceof EngineError)) throw err
    }
  }

  private uniqueName(name: string, selfId: string | null): string {
    const taken = new Set([...this.members.values()].filter((x) => x.id !== selfId).map((x) => x.name))
    if (!taken.has(name)) return name
    for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`
  }

  private newId(): string {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789'
    let s = ''
    for (let i = 0; i < 10; i++) s += abc[this.rand(abc.length)]
    return s
  }

  // ───────────── Сообщения ─────────────

  private onMessage(m: Member, msg: ClientMessage) {
    switch (msg.t) {
      case 'hello':
        return
      case 'ping':
        m.ping = msg.rtt
        m.link?.send({ t: 'pong', ts: msg.ts })
        return
      case 'action':
        return this.onAction(m, msg.handNo, msg.action)
      case 'bj':
        return this.onBj(m, msg.round, msg.action)
      case 'chat': {
        const now = this.sched.now()
        if (now - m.lastChat < 400) return
        m.lastChat = now
        this.sendAll({ t: 'chat', from: m.id, name: m.name, text: msg.text, ts: now })
        return
      }
      case 'sit':
        setSittingOut(this.game, m.id, msg.out)
        if (!msg.out) m.missed = 0
        this.broadcastView()
        this.maybeStartHand()
        return
      case 'rebuy':
        this.broadcastEvents(rebuy(this.game, m.id))
        this.save()
        this.maybeStartHand()
        return
      case 'show':
        return this.onShow(m)
      case 'leave':
        return this.onLeave(m)
    }

    if (!m.isHost) return
    switch (msg.t) {
      case 'config':
        return this.onConfig(msg.config)
      case 'start':
        return this.onStart()
      case 'addBot':
        return this.onAddBot()
      case 'kick': {
        const target = this.members.get(msg.id)
        if (!target || target.isHost) return
        this.kicked.add(target.token)
        target.link?.send({ t: 'reject', reason: 'kicked' })
        target.link?.close()
        target.link = null
        return this.onLeave(target)
      }
      case 'pause':
        return this.setPaused(msg.paused)
      case 'lock':
        this.locked = msg.locked
        this.broadcastView()
        this.save()
        return
      case 'again':
        return this.onAgain()
    }
  }

  private onAction(m: Member, handNo: number, action: PlayerAction) {
    const h = this.game.hand
    if (!h || h.done || h.handNo !== handNo || this.paused) return
    if (h.toAct !== this.seatOf(m.id)) return
    m.missed = 0
    this.act(m, action, [])
  }

  private act(m: Member, action: PlayerAction, prefix: ViewEvent[]) {
    // Сначала движок: если действие отклонено, таймер хода должен продолжать идти.
    const events = applyAction(this.game, m.id, action)
    this.clearTimers()
    this.afterEngine([...prefix, ...events])
  }

  private onShow(m: Member) {
    const h = this.game.hand
    if (!h || !h.done) return
    const hp = h.players.find((p) => p.id === m.id)
    if (!hp || this.shown.has(hp.seat)) return
    if (h.revealed && !hp.folded) return
    this.shown.add(hp.seat)
    this.broadcastEvents([{ t: 'show', seat: hp.seat, cards: [...hp.hole] }])
  }

  private onLeave(m: Member) {
    if (m.isHost && this.phase === 'playing') {
      this.finish()
      return
    }
    m.leaving = true
    const r = this.game.bj
    if (this.isBj && this.phase === 'playing' && r) {
      const seat = findPlayer(this.game, m.id)?.seat
      if (r.phase === 'playing' && r.seats.some((x) => x.id === m.id)) {
        // Руки доигрываются стопом, место освобождается после раунда.
        if (r.toAct?.seat === seat) this.bjForce(m, false)
        return
      }
      delete r.bets[m.id]
    }
    const h = this.game.hand
    if (this.phase === 'playing' && h && !h.done && inCurrentHand(this.game, m.id)) {
      if (h.toAct === this.seatOf(m.id)) this.act(m, { type: 'fold' }, [])
      return // уйдёт после раздачи
    }
    this.removeMember(m)
  }

  private removeMember(m: Member) {
    const events = leave(this.game, m.id)
    this.members.delete(m.id)
    m.link?.close()
    this.broadcastEvents([...events, { t: 'left', id: m.id, name: m.name }])
    if (this.game.finished && this.phase === 'playing') this.finish()
    this.save()
  }

  private onConfig(config: GameConfig) {
    if (this.phase !== 'lobby') return
    const c = configSchema.parse(config)
    if (c.smallBlind >= c.bigBlind || c.bigBlind > c.startingStack) throw new EngineError('bad blinds')
    if (seatedPlayers(this.game).length > c.maxSeats) throw new EngineError('too many players for that table')
    this.game.config = normalizeConfig(c)
    if (seatedPlayers(this.game).length > this.game.config.maxSeats) throw new EngineError('too many players for that table')
    for (const p of this.game.players) p.stack = c.startingStack
    this.broadcastView()
    this.save()
  }

  private onStart() {
    if (this.phase !== 'lobby') return
    if (!(this.isBj ? bjCanStart(this.game) : canStartHand(this.game))) throw new EngineError('need at least two players')
    this.phase = 'playing'
    this.scheduleNextHand(900)
    this.broadcastView()
  }

  private onAddBot() {
    const g = this.game
    if (seatedPlayers(g).length >= g.config.maxSeats || this.members.size >= MAX_MEMBERS) return
    if (this.phase === 'finished' || (this.phase === 'playing' && g.config.format === 'tournament')) return
    const used = new Set([...this.members.values()].map((x) => x.name))
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Бот ${this.members.size + 1}`
    const m: Member = {
      id: this.newId(),
      token: `bot-${this.newId()}${this.newId()}`,
      name,
      color: BOT_COLORS[this.members.size % BOT_COLORS.length]!,
      avatar: null,
      isBot: true,
      isHost: false,
      link: null,
      ping: null,
      missed: 0,
      leaving: false,
      lastChat: 0,
      rating: 1000,
      ratingGames: 0,
    }
    this.members.set(m.id, m)
    this.trySeat(m)
    this.broadcastEvents([{ t: 'joined', id: m.id, name: m.name }])
    this.maybeStartHand()
    this.save()
  }

  private onAgain() {
    if (this.phase !== 'finished') return
    const ratings = new Map(this.game.players.map((p) => [p.id, { rating: p.rating, ratingGames: p.ratingGames }]))
    const config = this.game.config
    this.game = createGame(config)
    this.phase = 'lobby'
    this.resetHandTrackers()
    for (const m of this.members.values()) {
      m.missed = 0
      this.trySeat(m)
      const p = findPlayer(this.game, m.id)
      const rating = ratings.get(m.id)
      if (p && rating) Object.assign(p, rating)
    }
    this.broadcastView()
    this.save()
  }

  private setPaused(paused: boolean) {
    if (this.phase !== 'playing' || paused === this.paused) return
    const now = this.sched.now()
    this.paused = paused
    if (paused) {
      if (this.turn) this.pausedRemaining = Math.max(0, this.turn.deadline - Math.max(now, this.turn.startsAt))
      this.clearTimers()
    } else if (this.turn) {
      const remaining = this.pausedRemaining ?? this.turn.totalMs
      this.turn.startsAt = now
      this.turn.deadline = now + remaining
      this.pausedRemaining = null
      this.armTurnTimer()
      this.armBot(0)
    } else {
      this.maybeStartHand()
    }
    this.broadcastView()
    this.save()
  }

  // ───────────── Ход игры ─────────────

  private afterEngine(raw: HostEvent[]) {
    const events = raw as ViewEvent[]
    this.track(events)
    const delay = batchDuration(events)
    const h = this.game.hand

    if (h && !h.done && h.toAct !== null) {
      this.setupTurn(h.toAct, delay)
      events.push({ t: 'turn', seat: h.toAct, totalMs: this.turn!.totalMs })
    } else {
      this.turn = null
      if (h?.done && events.some((e) => e.t === 'end')) {
        if (this.game.finished) this.scheduleFinish(delay + BETWEEN_HANDS_MS)
        else this.scheduleNextHand(delay + BETWEEN_HANDS_MS)
      }
    }
    this.broadcastEvents(events)
    this.save()
  }

  private track(events: ViewEvent[]) {
    for (const e of events) {
      switch (e.t) {
        case 'start':
          this.resetHandTrackers()
          break
        case 'post':
          this.lastActions.set(e.seat, { kind: 'post', amount: e.amount })
          break
        case 'act':
          this.lastActions.set(e.seat, { kind: e.allIn ? 'allin' : e.kind, amount: e.bet })
          break
        case 'board':
          for (const [seat, a] of this.lastActions) if (a.kind !== 'fold' && a.kind !== 'allin') this.lastActions.delete(seat)
          break
        case 'showdown':
          this.showdown = e.hands
          break
        case 'award':
          for (const w of e.winners) if (!this.winners.includes(w.seat)) this.winners.push(w.seat)
          break
      }
    }
  }

  private resetHandTrackers() {
    this.shown.clear()
    this.showdown = null
    this.winners = []
    this.lastActions.clear()
  }

  private setupTurn(seat: number, delay: number) {
    const m = this.memberAtSeat(seat)
    const now = this.sched.now()
    const full = this.game.config.turnSeconds * 1000
    const totalMs = m && !m.link && !m.isBot ? Math.min(full, DISCONNECTED_TURN_MS) : full
    this.turn = { seat, startsAt: now + delay, deadline: now + delay + totalMs, totalMs }
    if (this.paused) {
      this.pausedRemaining = totalMs
      return
    }
    this.armTurnTimer()
    this.armBot(delay)
  }

  private armTurnTimer() {
    if (this.turnTimer !== null) this.sched.clearTimeout(this.turnTimer)
    this.turnTimer = null
    if (!this.turn || this.paused) return
    const ms = this.turn.deadline - this.sched.now()
    this.turnTimer = this.sched.setTimeout(() => this.onTimeout(), Math.max(0, ms))
  }

  private armBot(delay: number) {
    if (this.botTimer !== null) this.sched.clearTimeout(this.botTimer)
    this.botTimer = null
    if (!this.turn) return
    if (this.isBj) return this.armBjBot(delay)
    const m = this.memberAtSeat(this.turn.seat)
    if (!m) return
    if (m.leaving) {
      this.botTimer = this.sched.setTimeout(() => this.forceAction(m, false), delay)
    } else if (m.isBot) {
      const think = 700 + this.rand(1500)
      this.botTimer = this.sched.setTimeout(() => this.botAct(m), delay + think)
    }
  }

  private clearTimers() {
    if (this.turnTimer !== null) this.sched.clearTimeout(this.turnTimer)
    if (this.botTimer !== null) this.sched.clearTimeout(this.botTimer)
    this.turnTimer = null
    this.botTimer = null
  }

  private onTimeout() {
    this.turnTimer = null
    if (!this.turn) return
    if (this.isBj) return this.bjTimeout()
    const m = this.memberAtSeat(this.turn.seat)
    if (!m) return
    this.forceAction(m, true)
  }

  /** Авто-ход: чек, если можно, иначе фолд. */
  private forceAction(m: Member, timedOut: boolean) {
    const legal = legalFor(this.game, m.id)
    if (!legal) return
    const prefix: ViewEvent[] = []
    if (timedOut) {
      m.missed += 1
      prefix.push({ t: 'timeout', seat: legal.seat })
      if (m.missed >= 2 && !m.isBot) setSittingOut(this.game, m.id, true)
    }
    this.act(m, legal.canCheck ? { type: 'check' } : { type: 'fold' }, prefix)
  }

  private botAct(m: Member) {
    this.botTimer = null
    const h = this.game.hand
    const legal = legalFor(this.game, m.id)
    if (!h || !legal) return
    const hp = h.players.find((p) => p.id === m.id)!
    const pot = h.players.reduce((s, p) => s + p.committed, 0)
    const opponents = h.players.filter((p) => !p.folded && p.id !== m.id).length
    const action = botDecision({
      hole: hp.hole,
      board: h.board,
      legal,
      pot,
      bb: h.blinds.bb,
      opponents,
      rand: this.rand,
    })
    try {
      this.act(m, action, [])
    } catch (err) {
      if (!(err instanceof EngineError)) throw err
      this.act(m, legal.canCheck ? { type: 'check' } : { type: 'fold' }, [])
    }
  }

  private scheduleNextHand(ms: number) {
    if (this.nextHandTimer !== null) this.sched.clearTimeout(this.nextHandTimer)
    this.nextHandAt = this.sched.now() + ms
    this.nextHandTimer = this.sched.setTimeout(() => {
      this.nextHandTimer = null
      this.nextHandAt = null
      this.betweenHands()
    }, ms)
  }

  private scheduleFinish(ms: number) {
    if (this.nextHandTimer !== null) this.sched.clearTimeout(this.nextHandTimer)
    this.nextHandTimer = this.sched.setTimeout(() => {
      this.nextHandTimer = null
      this.finish()
    }, ms)
  }

  private finish() {
    this.clearTimers()
    if (this.nextHandTimer !== null) this.sched.clearTimeout(this.nextHandTimer)
    this.nextHandTimer = null
    this.nextHandAt = null
    if (this.isBj) {
      const r = this.game.bj
      if (r?.phase === 'betting') bjCloseBets(this.game)
      while (r?.phase === 'playing' && r.toAct) {
        const p = r.seats.find((s) => s.seat === r.toAct!.seat)
        if (!p) break
        bjApply(this.game, p.id, { type: 'stand' })
      }
    } else {
      const h = this.game.hand
      while (h && !h.done && h.toAct !== null) {
        const p = h.players.find((x) => x.seat === h.toAct)
        if (!p) break
        applyAction(this.game, p.id, { type: 'fold' })
      }
    }
    this.game.finished = true
    applyGameRatings(this.game)
    for (const p of this.game.players) {
      const member = this.members.get(p.id)
      if (member) {
        member.rating = p.rating
        member.ratingGames = p.ratingGames
      }
    }
    this.phase = 'finished'
    this.turn = null
    this.clearTimers()
    this.broadcastView()
    this.save()
  }

  private betweenHands() {
    for (const m of [...this.members.values()]) if (m.leaving) this.removeMember(m)
    if (this.phase !== 'playing') return
    if (this.game.finished) return this.finish()
    if (this.paused) return this.broadcastView()
    if (this.isBj) {
      if (!bjCanStart(this.game)) return this.broadcastView()
      return this.afterBj(bjBegin(this.game, this.rand))
    }
    if (!canStartHand(this.game)) return this.broadcastView()
    const events = startNextHand(this.game, this.sched.now(), this.rand)
    this.afterEngine(events)
  }

  private maybeStartHand() {
    if (this.phase !== 'playing' || this.paused || this.nextHandTimer !== null) return
    if (this.isBj) {
      const r = this.game.bj
      if (r && r.phase !== 'done') return
      if (bjCanStart(this.game)) this.scheduleNextHand(1200)
      return
    }
    const h = this.game.hand
    if (h && !h.done) return
    if (canStartHand(this.game)) this.scheduleNextHand(1200)
  }

  // ───────────── Блэкджек ─────────────

  private get isBj() {
    return this.game.config.game === 'blackjack'
  }

  private onBj(m: Member, round: number, action: { type: 'bet'; amount: number } | BjAction) {
    const r = this.game.bj
    if (!r || r.roundNo !== round || this.paused) return
    if (action.type === 'bet') {
      const events = bjBet(this.game, m.id, action.amount)
      m.missed = 0
      this.broadcastEvents(events)
      this.save()
      if (bjAllBet(this.game)) this.closeBetsSoon()
      return
    }
    const seat = findPlayer(this.game, m.id)?.seat
    if (!r.toAct || r.toAct.seat !== seat) return
    m.missed = 0
    this.bjAct(m, action, [])
  }

  private bjAct(m: Member, action: BjAction, prefix: ViewEvent[]) {
    const events = bjApply(this.game, m.id, action)
    this.clearTimers()
    this.afterBj([...prefix, ...events])
  }

  /** Все поставили: даём фишкам долететь и раздаём. */
  private closeBetsSoon() {
    this.clearTimers()
    this.turnTimer = this.sched.setTimeout(() => this.closeBets(), 600)
  }

  private closeBets() {
    this.clearTimers()
    const r = this.game.bj
    if (!r || r.phase !== 'betting') return
    for (const p of seatedPlayers(this.game)) {
      const m = this.members.get(p.id)
      if (!m || m.isBot || p.status !== 'active' || r.bets[p.id]) continue
      m.missed += 1
      if (m.missed >= BJ_IDLE_ROUNDS) setSittingOut(this.game, p.id, true)
    }
    this.afterBj(bjCloseBets(this.game))
  }

  private afterBj(raw: HostEvent[]) {
    const events = raw as ViewEvent[]
    const r = this.game.bj!
    const delay = batchDuration(events)
    const now = this.sched.now()
    const full = this.game.config.turnSeconds * 1000
    if (r.phase === 'betting') {
      this.turn = { seat: -1, startsAt: now + delay, deadline: now + delay + full, totalMs: full }
      if (this.paused) this.pausedRemaining = full
      else {
        this.armTurnTimer()
        this.armBjBot(delay)
      }
      events.push({ t: 'bj_turn', seat: -1, hand: 0, totalMs: full })
    } else if (r.phase === 'playing' && r.toAct) {
      this.setupTurn(r.toAct.seat, delay)
      events.push({ t: 'bj_turn', seat: r.toAct.seat, hand: r.toAct.hand, totalMs: this.turn!.totalMs })
    } else {
      this.turn = null
      this.scheduleNextHand(delay + BJ_BETWEEN_MS)
    }
    this.broadcastEvents(events)
    this.save()
  }

  private bjTimeout() {
    const r = this.game.bj
    if (!r) return
    if (r.phase === 'betting') return this.closeBets()
    if (r.phase !== 'playing' || !r.toAct) return
    const m = this.memberAtSeat(r.toAct.seat)
    if (m) this.bjForce(m, true)
  }

  /** Время вышло или игрок ушёл: рука стоит. */
  private bjForce(m: Member, timedOut: boolean) {
    const r = this.game.bj
    if (!r?.toAct) return
    const prefix: ViewEvent[] = []
    if (timedOut) {
      m.missed += 1
      prefix.push({ t: 'timeout', seat: r.toAct.seat })
      if (m.missed >= 2 && !m.isBot) setSittingOut(this.game, m.id, true)
    }
    this.bjAct(m, { type: 'stand' }, prefix)
  }

  private armBjBot(delay: number) {
    const r = this.game.bj
    if (!r) return
    if (r.phase === 'betting') {
      const bots = seatedPlayers(this.game).filter((p) => this.members.get(p.id)?.isBot && p.status === 'active' && !r.bets[p.id])
      if (bots.length === 0) return
      this.botTimer = this.sched.setTimeout(() => {
        this.botTimer = null
        const events: HostEvent[] = []
        for (const p of bots) {
          const min = bjMinBet(this.game)
          const amount = Math.min(p.stack, bjMaxBet(this.game), min * (1 + this.rand(4)))
          if (amount >= min) events.push(...bjBet(this.game, p.id, amount))
        }
        this.broadcastEvents(events)
        this.save()
        if (bjAllBet(this.game)) this.closeBetsSoon()
      }, delay + 600 + this.rand(900))
      return
    }
    if (r.phase !== 'playing' || !r.toAct) return
    const m = this.memberAtSeat(r.toAct.seat)
    if (!m) return
    if (m.leaving) {
      this.botTimer = this.sched.setTimeout(() => this.bjForce(m, false), delay)
    } else if (m.isBot) {
      this.botTimer = this.sched.setTimeout(() => {
        this.botTimer = null
        const legal = bjLegalFor(this.game, m.id)
        const cur = this.game.bj
        if (!legal || !cur?.toAct) return
        const hand = cur.seats.find((x) => x.seat === cur.toAct!.seat)!.hands[cur.toAct.hand]!
        this.bjAct(m, bjBotAction(hand.cards, cur.dealer[0]!, legal), [])
      }, delay + 600 + this.rand(1100))
    }
  }

  private bjView(m: Member): BjView | null {
    const g = this.game
    const r = g.bj
    if (!r) return null
    const gp = findPlayer(g, m.id)
    const seats =
      r.phase === 'betting'
        ? seatedPlayers(g)
            .filter((p) => p.status === 'active')
            .map((p) => ({ seat: p.seat, id: p.id, bet: r.bets[p.id] ?? null, hands: [] }))
        : r.seats.map((x) => ({
            seat: x.seat,
            id: x.id,
            bet: null,
            hands: x.hands.map((h) => ({
              cards: [...h.cards],
              bet: h.bet,
              ...bjTotal(h.cards),
              doubled: h.doubled,
              done: h.done,
              result: h.result,
              payout: h.payout,
            })),
          }))
    const dealer: (Card | null)[] = r.dealer.map((c, i) => (r.holeHidden && i === 1 ? null : c))
    const open = dealer.filter((c): c is Card => c !== null)
    const dt = open.length ? bjTotal(open) : null
    return {
      roundNo: r.roundNo,
      phase: r.phase,
      minBet: bjMinBet(g),
      maxBet: bjMaxBet(g),
      dealer: { cards: dealer, total: dt?.total ?? null, soft: dt?.soft ?? false },
      seats,
      toAct: r.toAct ? { ...r.toAct } : null,
      shoeLeft: g.shoe.length,
      you: {
        legal: this.paused ? null : bjLegalFor(g, m.id),
        canBet: r.phase === 'betting' && !!gp && gp.status === 'active' && gp.stack >= bjMinBet(g),
        bet: r.bets[m.id] ?? null,
      },
    }
  }

  // ───────────── Рассылка ─────────────

  private broadcastEvents(events: HostEvent[], except?: string) {
    this.seq += 1
    for (const m of this.members.values()) {
      if (!m.link || m.id === except) continue
      m.link.send({ t: 'events', seq: this.seq, events: this.eventsFor(m, events), view: this.viewFor(m) })
    }
  }

  private broadcastView() {
    for (const m of this.members.values()) m.link?.send({ t: 'view', view: this.viewFor(m) })
  }

  private sendAll(msg: HostMessage) {
    for (const m of this.members.values()) m.link?.send(msg)
  }

  private sendAvatar(m: Member) {
    for (const x of this.members.values()) if (x !== m) x.link?.send({ t: 'avatar', id: m.id, avatar: m.avatar })
  }

  private eventsFor(m: Member, events: HostEvent[]): ViewEvent[] {
    const hp = this.game.hand?.players.find((p) => p.id === m.id)
    return events.map((e) => (e.t === 'deal' ? { t: 'deal', order: e.order, yours: hp ? [...hp.hole] : null } : e))
  }

  private seatOf(id: string): number | null {
    return this.game.hand?.players.find((p) => p.id === id)?.seat ?? findPlayer(this.game, id)?.seat ?? null
  }

  private memberAtSeat(seat: number): Member | undefined {
    const id = this.game.hand?.players.find((p) => p.seat === seat)?.id ?? seatedPlayers(this.game).find((p) => p.seat === seat)?.id
    return id ? this.members.get(id) : undefined
  }

  /** Публичное и личное состояние стола для конкретного участника. */
  private viewFor(m: Member): TableView {
    const g = this.game
    const h = g.hand
    const now = this.sched.now()
    const live = h && !h.done

    const players: PlayerView[] = [...this.members.values()].map((x) => {
      const gp = findPlayer(g, x.id)
      const hp = live ? h.players.find((p) => p.id === x.id) : undefined
      return {
        id: x.id,
        name: x.name,
        color: x.color,
        seat: gp?.seat ?? null,
        stack: hp ? hp.stack : (gp?.stack ?? 0),
        status: gp?.status ?? 'spectator',
        isBot: x.isBot,
        isHost: x.isHost,
        connected: x.isBot || x.link !== null,
        ping: x.ping,
        buyIns: gp?.buyIns ?? 0,
        place: gp?.place ?? null,
        hasAvatar: x.avatar !== null,
        rating: gp?.rating ?? 1000,
        ratingGames: gp?.ratingGames ?? 0,
      }
    })
    players.sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99))

    let hand: HandView | null = null
    // Зритель: не сидит в этой раздаче и не может в неё вмешаться (нет места или выбыл).
    const me = findPlayer(g, m.id)
    const spectator =
      g.config.spectatorsSeeCards !== false &&
      !!h &&
      !h.players.some((p) => p.id === m.id) &&
      (!me || me.status === 'busted')
    if (h) {
      hand = {
        handNo: h.handNo,
        button: h.button,
        sbSeat: h.sbSeat,
        bbSeat: h.bbSeat,
        blinds: h.blinds,
        street: h.street,
        board: [...h.board],
        pot: h.players.reduce((s, p) => s + p.committed - p.bet, 0),
        seats: h.players.map((p) => {
          const visible = p.id === m.id || (h.revealed && !p.folded) || this.shown.has(p.seat) || spectator
          return {
            seat: p.seat,
            id: p.id,
            bet: p.bet,
            folded: p.folded,
            allIn: p.allIn,
            cards: visible ? [...p.hole] : null,
            lastAction: this.lastActions.get(p.seat) ?? null,
          }
        }),
        toAct: h.toAct,
        currentBet: h.currentBet,
        minRaise: h.minRaise,
        done: h.done,
        showdown: this.showdown,
        winners: [...this.winners],
      }
    }

    const gp = findPlayer(g, m.id)
    const hp = h?.players.find((p) => p.id === m.id)
    const nla = nextLevelAt(g)
    const pausedTurn = this.paused && this.turn
    return {
      phase: this.phase,
      paused: this.paused,
      locked: this.locked,
      code: this.code,
      hostId: [...this.members.values()].find((x) => x.isHost)?.id ?? '',
      config: g.config,
      players,
      handNo: g.handNo,
      level: g.level,
      blinds: h ? h.blinds : blindsForLevel(g.config, g.level),
      nextLevelInMs: nla === null || this.phase !== 'playing' ? null : Math.max(0, nla - now),
      hand,
      bj: this.bjView(m),
      turn: this.turn
        ? {
            seat: this.turn.seat,
            remainingMs: pausedTurn
              ? (this.pausedRemaining ?? this.turn.totalMs)
              : Math.max(0, this.turn.deadline - now),
            totalMs: this.turn.totalMs,
          }
        : null,
      nextHandInMs: this.nextHandAt === null ? null : Math.max(0, this.nextHandAt - now),
      results: g.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: this.members.get(p.id)?.color ?? '#a59d90',
        place: p.place,
        net: p.stack - p.buyIns * g.config.startingStack,
        buyIns: p.buyIns,
        rating: p.rating,
        ratingDelta: p.ratingDelta,
      })),
      you: {
        id: m.id,
        spectator,
        legal: this.paused ? null : legalFor(g, m.id),
        canRebuy: !!gp && canReenter(g, gp),
        reentriesLeft: gp ? Math.min(99, reentriesLeft(g, gp)) : 0,
        canShow: !!h && h.done && !!hp && !this.shown.has(hp.seat) && !(h.revealed && !hp.folded),
      },
    }
  }

  // ───────────── Сохранение ─────────────

  snapshot(): HostSnapshot {
    return {
      v: 1,
      code: this.code,
      hostToken: this.hostToken,
      phase: this.phase,
      game: this.game,
      members: [...this.members.values()].map(({ link: _link, ...rest }) => rest),
      kicked: [...this.kicked],
      locked: this.locked,
      seq: this.seq,
      shown: [...this.shown],
      showdown: this.showdown,
      winners: this.winners,
      lastActions: [...this.lastActions],
      savedAt: this.sched.now(),
    }
  }

  private save() {
    if (this.onSnapshot) this.onSnapshot(structuredClone(this.snapshot()))
  }

  /** Для тестов и отладки. */
  get state() {
    return { game: this.game, phase: this.phase, paused: this.paused, members: [...this.members.values()] }
  }
}
