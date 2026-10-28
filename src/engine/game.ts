import { shuffledDeck, type Card, type RandomInt, cryptoRandomInt } from './cards.ts'
import {
  act,
  EngineError,
  legalActions,
  startHand,
  type Blinds,
  type HandEvent,
  type HandState,
  type LegalActions,
  type PlayerAction,
} from './hand.ts'

export type Format = 'tournament' | 'cash'

export interface GameConfig {
  format: Format
  startingStack: number
  smallBlind: number
  bigBlind: number
  /** Турнир: анте с четвёртого уровня. */
  antes: boolean
  /** Турнир: длина уровня блайндов, 0 = блайнды не растут. */
  levelMinutes: number
  /** Кэш: можно докупиться после вылета. */
  allowRebuy: boolean
  turnSeconds: number
  maxSeats: number
}

export const DEFAULT_CONFIG: GameConfig = {
  format: 'tournament',
  startingStack: 2000,
  smallBlind: 10,
  bigBlind: 20,
  antes: false,
  levelMinutes: 10,
  allowRebuy: true,
  turnSeconds: 25,
  maxSeats: 9,
}

export type PlayerStatus = 'active' | 'sittingOut' | 'busted' | 'left'

export interface GamePlayer {
  id: string
  name: string
  seat: number
  stack: number
  status: PlayerStatus
  buyIns: number
  place: number | null
  isBot: boolean
}

export interface GameState {
  config: GameConfig
  players: GamePlayer[]
  handNo: number
  button: number | null
  level: number
  startedAt: number | null
  hand: HandState | null
  finished: boolean
}

export type GameEvent =
  | HandEvent
  | { t: 'level'; level: number; blinds: Blinds }
  | { t: 'bust'; id: string; seat: number; place: number | null }
  | { t: 'rebuy'; id: string; seat: number; stack: number }
  | { t: 'finish'; standings: { id: string; place: number }[] }

export const MAX_SEATS = 9

export function createGame(config: GameConfig): GameState {
  return {
    config: { ...config, maxSeats: Math.max(2, Math.min(MAX_SEATS, config.maxSeats)) },
    players: [],
    handNo: 0,
    button: null,
    level: 0,
    startedAt: null,
    hand: null,
    finished: false,
  }
}

export function seatedPlayers(g: GameState): GamePlayer[] {
  return g.players.filter((p) => p.status !== 'left').sort((a, b) => a.seat - b.seat)
}

export function addPlayer(
  g: GameState,
  p: { id: string; name: string; isBot?: boolean; seat?: number },
): GamePlayer {
  if (g.players.some((x) => x.id === p.id && x.status !== 'left')) throw new EngineError('already seated')
  const taken = new Set(seatedPlayers(g).map((x) => x.seat))
  let seat = p.seat
  if (seat === undefined || taken.has(seat) || seat < 0 || seat >= g.config.maxSeats) {
    seat = -1
    for (let s = 0; s < g.config.maxSeats; s++)
      if (!taken.has(s)) {
        seat = s
        break
      }
  }
  if (seat < 0) throw new EngineError('table is full')
  const lateTournament = g.config.format === 'tournament' && g.startedAt !== null
  if (lateTournament) throw new EngineError('tournament already started')
  g.players = g.players.filter((x) => x.id !== p.id)
  const player: GamePlayer = {
    id: p.id,
    name: p.name,
    seat,
    stack: g.config.startingStack,
    status: 'active',
    buyIns: 1,
    place: null,
    isBot: p.isBot ?? false,
  }
  g.players.push(player)
  return player
}

export function findPlayer(g: GameState, id: string): GamePlayer | undefined {
  return g.players.find((p) => p.id === id && p.status !== 'left')
}

/** Игрок участвует в текущей раздаче и ещё не сбросил карты. */
export function inCurrentHand(g: GameState, id: string): boolean {
  const p = g.hand?.players.find((x) => x.id === id)
  return !!p && !p.folded && !(g.hand?.done ?? true)
}

export function blindsForLevel(cfg: GameConfig, level: number): Blinds {
  if (cfg.format === 'cash' || level === 0) {
    return { sb: cfg.smallBlind, bb: cfg.bigBlind, ante: 0 }
  }
  const mult = LEVEL_MULTIPLIERS[Math.min(level, LEVEL_MULTIPLIERS.length - 1)]!
  const extra = Math.max(0, level - (LEVEL_MULTIPLIERS.length - 1))
  const bb = niceRound(cfg.bigBlind * mult * 2 ** extra)
  const sbRatio = cfg.smallBlind / cfg.bigBlind
  const sb = Math.max(1, niceRound(bb * sbRatio))
  const ante = cfg.antes && level >= 3 ? Math.max(1, niceRound(bb / 10)) : 0
  return { sb, bb, ante }
}

const LEVEL_MULTIPLIERS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100]

function niceRound(x: number): number {
  if (x < 10) return Math.max(1, Math.round(x))
  const mag = 10 ** Math.floor(Math.log10(x))
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const norm = x / mag
  let best = steps[0]!
  for (const s of steps) if (Math.abs(s - norm) < Math.abs(best - norm)) best = s
  return Math.round(best * mag)
}

export function levelAt(g: GameState, now: number): number {
  if (g.config.format !== 'tournament' || g.config.levelMinutes <= 0 || g.startedAt === null) return 0
  return Math.floor((now - g.startedAt) / (g.config.levelMinutes * 60_000))
}

/** Когда начнётся следующий уровень (мс), или null. */
export function nextLevelAt(g: GameState): number | null {
  if (g.config.format !== 'tournament' || g.config.levelMinutes <= 0 || g.startedAt === null) return null
  return g.startedAt + (g.level + 1) * g.config.levelMinutes * 60_000
}

function eligibleForHand(g: GameState): GamePlayer[] {
  return seatedPlayers(g).filter((p) => p.status === 'active' && p.stack > 0)
}

export function canStartHand(g: GameState): boolean {
  return !g.finished && (!g.hand || g.hand.done) && eligibleForHand(g).length >= 2
}

export function startNextHand(
  g: GameState,
  now: number,
  rand: RandomInt = cryptoRandomInt,
  deck?: Card[],
): GameEvent[] {
  if (!canStartHand(g)) throw new EngineError('cannot start a hand')
  const events: GameEvent[] = []
  if (g.startedAt === null) g.startedAt = now

  const level = levelAt(g, now)
  if (level !== g.level || g.handNo === 0) {
    g.level = level
    events.push({ t: 'level', level, blinds: blindsForLevel(g.config, level) })
  }

  const dealt = eligibleForHand(g)
  g.button = nextButton(g, dealt, rand)
  g.handNo += 1
  const { hand, events: handEvents } = startHand({
    handNo: g.handNo,
    seats: dealt.map((p) => ({ id: p.id, seat: p.seat, stack: p.stack })),
    button: g.button,
    blinds: blindsForLevel(g.config, g.level),
    deck: deck ?? shuffledDeck(rand),
  })
  g.hand = hand
  events.push(...handEvents)
  if (hand.done) events.push(...settle(g))
  return events
}

function nextButton(g: GameState, dealt: GamePlayer[], rand: RandomInt): number {
  const seats = dealt.map((p) => p.seat)
  if (g.button === null) return seats[rand(seats.length)]!
  return seats.find((s) => s > g.button!) ?? seats[0]!
}

export function legalFor(g: GameState, id: string): LegalActions | null {
  const h = g.hand
  if (!h || h.done || h.toAct === null) return null
  const p = h.players.find((x) => x.id === id)
  if (!p || p.seat !== h.toAct) return null
  return legalActions(h, p.seat)
}

export function applyAction(g: GameState, id: string, action: PlayerAction): GameEvent[] {
  const h = g.hand
  if (!h || h.done) throw new EngineError('no hand in progress')
  const p = h.players.find((x) => x.id === id)
  if (!p) throw new EngineError('not in this hand')
  const events: GameEvent[] = act(h, p.seat, action)
  if (h.done) events.push(...settle(g))
  return events
}

/** Переносит стеки после раздачи, отмечает вылетевших, завершает турнир. */
function settle(g: GameState): GameEvent[] {
  const h = g.hand!
  const events: GameEvent[] = []
  for (const hp of h.players) {
    const gp = g.players.find((p) => p.id === hp.id && p.status !== 'left')
    if (gp) gp.stack = hp.stack
  }

  const busted = h.players
    .filter((hp) => hp.stack === 0)
    .map((hp) => g.players.find((p) => p.id === hp.id && p.status !== 'left'))
    .filter((p): p is GamePlayer => !!p && p.status !== 'busted')

  if (g.config.format === 'tournament') {
    // Кто начал раздачу с большим стеком, занимает место выше.
    const startOf = (id: string) => h.players.find((x) => x.id === id)!.startStack
    busted.sort((a, b) => startOf(a.id) - startOf(b.id))
    let remaining = g.players.filter((p) => p.place === null && p.status !== 'left' && p.stack > 0).length
    for (let i = 0; i < busted.length; i++) {
      const p = busted[i]!
      p.status = 'busted'
      p.place = remaining + (busted.length - i)
      events.push({ t: 'bust', id: p.id, seat: p.seat, place: p.place })
    }
    remaining = g.players.filter((p) => p.place === null && p.status !== 'left' && p.stack > 0).length
    if (remaining <= 1) {
      const winner = g.players.find((p) => p.place === null && p.status !== 'left' && p.stack > 0)
      if (winner) winner.place = 1
      g.finished = true
      events.push({
        t: 'finish',
        standings: g.players
          .filter((p) => p.place !== null)
          .sort((a, b) => a.place! - b.place!)
          .map((p) => ({ id: p.id, place: p.place! })),
      })
    }
  } else {
    for (const p of busted) {
      p.status = 'busted'
      events.push({ t: 'bust', id: p.id, seat: p.seat, place: null })
    }
  }
  return events
}

export function rebuy(g: GameState, id: string): GameEvent[] {
  const p = findPlayer(g, id)
  if (!p) throw new EngineError('no such player')
  if (g.config.format !== 'cash' || !g.config.allowRebuy) throw new EngineError('rebuys are off')
  if (p.status !== 'busted') throw new EngineError('still has chips')
  p.stack = g.config.startingStack
  p.buyIns += 1
  p.status = 'active'
  return [{ t: 'rebuy', id: p.id, seat: p.seat, stack: p.stack }]
}

export function setSittingOut(g: GameState, id: string, out: boolean) {
  const p = findPlayer(g, id)
  if (!p || p.status === 'busted') return
  p.status = out ? 'sittingOut' : 'active'
}

/**
 * Игрок уходит из-за стола. В кэше уносит стек (идёт в итоговую таблицу),
 * в турнире выбывает с текущим местом. Если он в раздаче, хост сначала сбрасывает его карты.
 */
export function leave(g: GameState, id: string): GameEvent[] {
  const p = findPlayer(g, id)
  if (!p) return []
  if (inCurrentHand(g, id)) throw new EngineError('fold first')
  const events: GameEvent[] = []
  if (g.config.format === 'tournament' && g.startedAt !== null && p.place === null) {
    const remaining = g.players.filter((x) => x.place === null && x.status !== 'left' && x.stack > 0)
    p.place = remaining.length
    p.stack = 0
    events.push({ t: 'bust', id: p.id, seat: p.seat, place: p.place })
  }
  p.status = 'left'
  if (g.config.format === 'tournament' && g.startedAt !== null) {
    const alive = g.players.filter((x) => x.place === null && x.status !== 'left' && x.stack > 0)
    if (alive.length === 1 && !g.finished) {
      alive[0]!.place = 1
      g.finished = true
      events.push({
        t: 'finish',
        standings: g.players
          .filter((x) => x.place !== null)
          .sort((a, b) => a.place! - b.place!)
          .map((x) => ({ id: x.id, place: x.place! })),
      })
    }
  }
  return events
}

/** Сколько фишек сейчас в игре (для проверок сохранения). */
export function chipsInPlay(g: GameState): number {
  const h = g.hand
  if (h && !h.done) {
    const inHand = new Set(h.players.map((p) => p.id))
    const outside = g.players
      .filter((p) => p.status !== 'left' && !inHand.has(p.id))
      .reduce((s, p) => s + p.stack, 0)
    return outside + h.players.reduce((s, p) => s + p.stack + p.committed, 0)
  }
  return g.players.filter((p) => p.status !== 'left').reduce((s, p) => s + p.stack, 0)
}
