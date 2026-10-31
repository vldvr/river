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

import type { BjRound } from './blackjack.ts'
import { initialRating, updateRatings } from './rating.ts'

export type Format = 'tournament' | 'cash'
export type GameKind = 'holdem' | 'blackjack'

export interface GameConfig {
  /** Во что играем. В блэкджеке большой блайнд служит минимальной ставкой, формат всегда кэш. */
  game: GameKind
  format: Format
  startingStack: number
  smallBlind: number
  bigBlind: number
  /** Турнир: анте с четвёртого уровня. */
  antes: boolean
  /** Турнир: длина уровня блайндов, 0 = блайнды не растут. */
  levelMinutes: number
  /** Сколько раз можно войти снова после вылета (турнир и кэш). UNLIMITED_REENTRIES: без ограничений. */
  reentries: number
  turnSeconds: number
  maxSeats: number
  /** Зрители и выбывшие видят карты всех игроков. */
  spectatorsSeeCards: boolean
}

export const DEFAULT_CONFIG: GameConfig = {
  game: 'holdem',
  format: 'tournament',
  startingStack: 2000,
  smallBlind: 10,
  bigBlind: 20,
  antes: false,
  levelMinutes: 10,
  reentries: 1,
  turnSeconds: 25,
  maxSeats: 9,
  spectatorsSeeCards: true,
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
  /** Порядковый номер вылета: кто вылетел позже, тот выше в турнире. */
  bustSeq: number | null
  rating: number
  ratingGames: number
  ratingDelta: number
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
  /** Guards against applying one table result more than once. */
  ratingApplied: boolean
  bustCounter: number
  /** Блэкджек: текущий раунд и шуз. */
  bj: BjRound | null
  shoe: Card[]
}

export type GameEvent =
  | HandEvent
  | { t: 'level'; level: number; blinds: Blinds }
  | { t: 'bust'; id: string; seat: number; place: number | null }
  | { t: 'rebuy'; id: string; seat: number; stack: number }
  | { t: 'finish'; standings: { id: string; place: number }[] }

export const MAX_SEATS = 9
export const UNLIMITED_REENTRIES = 99

/** Сколько повторных входов осталось у игрока. */
export function reentriesLeft(g: GameState, p: GamePlayer): number {
  if (g.config.reentries >= UNLIMITED_REENTRIES) return Infinity
  return Math.max(0, g.config.reentries - (p.buyIns - 1))
}

/** Вылетевший игрок может войти снова прямо сейчас. */
export function canReenter(g: GameState, p: GamePlayer): boolean {
  return !g.finished && p.status === 'busted' && p.place === null && reentriesLeft(g, p) > 0
}

export function createGame(config: GameConfig): GameState {
  return {
    config: normalizeConfig(config),
    players: [],
    handNo: 0,
    button: null,
    level: 0,
    startedAt: null,
    hand: null,
    finished: false,
    ratingApplied: false,
    bustCounter: 0,
    bj: null,
    shoe: [],
  }
}

/** Блэкджек всегда кэш и не больше 7 мест; холдем до 9. */
export function normalizeConfig(c: GameConfig): GameConfig {
  const bj = c.game === 'blackjack'
  return {
    ...c,
    format: bj ? 'cash' : c.format,
    maxSeats: Math.max(bj ? 1 : 2, Math.min(bj ? 7 : MAX_SEATS, c.maxSeats)),
  }
}

export function seatedPlayers(g: GameState): GamePlayer[] {
  return g.players.filter((p) => p.status !== 'left').sort((a, b) => a.seat - b.seat)
}

export function addPlayer(
  g: GameState,
  p: { id: string; name: string; isBot?: boolean; seat?: number; rating?: number; ratingGames?: number },
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
    bustSeq: null,
    rating: p.rating ?? initialRating().rating,
    ratingGames: p.ratingGames ?? initialRating().games,
    ratingDelta: 0,
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
    const remaining = g.players.filter((p) => p.place === null && p.status !== 'left' && p.stack > 0).length
    const final = remaining <= 1
    // Без повторных входов место известно сразу. С ними кто-то ещё может вернуться,
    // поэтому места раздаются в конце по порядку вылета (иначе номера могли бы совпасть).
    const placed = final || g.config.reentries === 0 ? busted : []
    for (const p of busted) {
      p.status = 'busted'
      p.bustSeq = ++g.bustCounter
    }
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i]!
      p.place = remaining + (placed.length - i)
    }
    for (const p of busted) events.push({ t: 'bust', id: p.id, seat: p.seat, place: p.place })
    if (final) events.push(...finishTournament(g))
  } else {
    for (const p of busted) {
      p.status = 'busted'
      events.push({ t: 'bust', id: p.id, seat: p.seat, place: null })
    }
  }
  return events
}

/** Конец турнира: победитель первый, ждавшие повторного входа занимают места по порядку вылета. */
function finishTournament(g: GameState): GameEvent[] {
  const alive = g.players.filter((p) => p.place === null && p.status !== 'left' && p.stack > 0)
  if (alive.length === 1) alive[0]!.place = 1
  const used = new Set(g.players.map((p) => p.place).filter((x): x is number => x !== null))
  const free: number[] = []
  for (let i = 1; i <= g.players.length; i++) if (!used.has(i)) free.push(i)
  const pending = g.players.filter((p) => p.place === null).sort((a, b) => (b.bustSeq ?? 0) - (a.bustSeq ?? 0))
  pending.forEach((p, i) => (p.place = free[i] ?? g.players.length))
  g.finished = true
  applyGameRatings(g)
  return [
    {
      t: 'finish',
      standings: g.players
        .filter((p) => p.place !== null)
        .sort((a, b) => a.place! - b.place!)
        .map((p) => ({ id: p.id, place: p.place! })),
    },
  ]
}

/** Applies one rating result per player, exactly once when a game is finished. */
export function applyGameRatings(g: GameState): void {
    if (g.ratingApplied || g.players.length === 0) return
    const players = g.players.map((p) => ({
      player: p,
      net: p.stack - p.buyIns * g.config.startingStack,
    }))
    const byNet = [...players].sort((a, b) => b.net - a.net)
    const netRank = new Map<string, number>()
    for (let i = 0; i < byNet.length; i++) {
      if (i === 0 || byNet[i]!.net !== byNet[i - 1]!.net) netRank.set(byNet[i]!.player.id, i + 1)
      else netRank.set(byNet[i]!.player.id, netRank.get(byNet[i - 1]!.player.id)!)
    }
    const minNet = byNet.at(-1)!.net
    const maxNet = byNet[0]!.net
    const netRange = maxNet - minNet
    const ranked = players.map(({ player, net }) => ({
      id: player.id,
      rating: player.rating,
      games: player.ratingGames,
      rank: player.place ?? netRank.get(player.id)!,
      score:
        players.length === 1
          ? net > 0
            ? 1
            : net < 0
              ? 0
              : 0.5
          : netRange === 0
            ? 0.5
            : (net - minNet) / netRange,
    }))
  if (ranked.every((p) => p.rank === 1)) {
    const ordered = [...ranked].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    for (let i = 0; i < ordered.length; i++) ordered[i]!.rank = i + 1
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i]!.score === ordered[i - 1]!.score) ordered[i]!.rank = ordered[i - 1]!.rank
    }
  }
  for (const change of updateRatings(ranked)) {
    const p = g.players.find((x) => x.id === change.id)
    if (p) {
      p.rating = change.rating
      p.ratingGames = change.games
      p.ratingDelta = change.delta
    }
    g.ratingApplied = true
  }
}

/** Повторный вход: в кэше докупка, в турнире новый стек, пока турнир не кончился. */
export function rebuy(g: GameState, id: string): GameEvent[] {
  const p = findPlayer(g, id)
  if (!p) throw new EngineError('no such player')
  if (p.status !== 'busted') throw new EngineError('still has chips')
  if (!canReenter(g, p)) throw new EngineError('rebuys are off')
  p.stack = g.config.startingStack
  p.buyIns += 1
  p.status = 'active'
  p.bustSeq = null
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
  if (g.config.format === 'tournament' && g.startedAt !== null && p.place === null && p.stack > 0) {
    // Уходит с фишками: ниже всех, кто ещё играет. Вылетевший раньше получит место в конце по порядку вылета.
    const remaining = g.players.filter((x) => x.place === null && x.status !== 'left' && x.stack > 0)
    p.place = remaining.length
    p.stack = 0
    events.push({ t: 'bust', id: p.id, seat: p.seat, place: p.place })
  }
  p.status = 'left'
  if (g.config.format === 'tournament' && g.startedAt !== null && !g.finished) {
    const alive = g.players.filter((x) => x.place === null && x.status !== 'left' && x.stack > 0)
    if (alive.length <= 1) events.push(...finishTournament(g))
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
