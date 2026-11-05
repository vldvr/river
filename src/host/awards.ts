import { equity, handScore, scoreCategory, type Card } from '../engine/index.ts'
import type { AwardKind, AwardView, ViewEvent } from '../protocol/index.ts'

// Номинации в итогах партии. Считаются только по открытому: карты, которые все видели на вскрытии,
// ставки и время на ход. Сброшенные карты сюда не попадают, иначе номинация выдала бы чужую руку.

export interface PlayerStats {
  hands: number
  /** Раздачи, где сам вложил фишки на префлопе (колл, бет, рейз; блайнд не в счёт). */
  vpip: number
  /** Беты и рейзы. */
  aggr: number
  /** Раздачи, где пошёл олл-ин. */
  allins: number
  thinkMs: number
  decisions: number
}

interface HandTrack {
  handNo: number
  bb: number
  seats: Record<number, string>
  street: string
  board: Card[]
  vpip: string[]
  allin: string[]
  /** Шансы на момент олл-ина, если карты вскрылись до ривера. */
  equity: Record<number, number> | null
}

export interface GameStats {
  players: Record<string, PlayerStats>
  bestHand: { id: string; score: number; name: string; handNo: number } | null
  bigPot: { id: string; amount: number; bb: number; handNo: number } | null
  badBeat: { id: string; equity: number; handNo: number } | null
  suckout: { id: string; equity: number; handNo: number } | null
  hand: HandTrack | null
}

export function newStats(): GameStats {
  return { players: {}, bestHand: null, bigPot: null, badBeat: null, suckout: null, hand: null }
}

function player(s: GameStats, id: string): PlayerStats {
  return (s.players[id] ??= { hands: 0, vpip: 0, aggr: 0, allins: 0, thinkMs: 0, decisions: 0 })
}

/** Пороги: номинация достаётся, только если было за что. */
const BAD_BEAT = 0.6
const SUCKOUT = 0.4
const MIN_HANDS = 10
const LOOSE = 0.4
const TIGHT = 0.2
const MIN_ALLINS = 3
const MIN_AGGR = 5
const MIN_DECISIONS = 6
const THINKER_MS = 5000
const BIG_POT_BB = 8
const MAX_AWARDS = 6

export function trackStats(s: GameStats, events: readonly ViewEvent[]) {
  for (const e of events) {
    const h = s.hand
    switch (e.t) {
      case 'start':
        s.hand = { handNo: e.handNo, bb: e.blinds.bb, seats: {}, street: 'preflop', board: [], vpip: [], allin: [], equity: null }
        for (const seat of e.seats) {
          s.hand.seats[seat.seat] = seat.id
          player(s, seat.id).hands++
        }
        break
      case 'act': {
        const id = h?.seats[e.seat]
        if (!h || !id) break
        if (h.street === 'preflop' && e.kind !== 'fold' && e.kind !== 'check' && !h.vpip.includes(id)) h.vpip.push(id)
        if (e.kind === 'bet' || e.kind === 'raise') player(s, id).aggr++
        if (e.allIn && !h.allin.includes(id)) h.allin.push(id)
        break
      }
      case 'board':
        if (!h) break
        h.street = e.street
        h.board.push(...e.cards)
        break
      case 'reveal':
        // Вскрытие до ривера значит олл-ин: запоминаем, у кого какие были шансы.
        if (!h || h.board.length >= 5 || e.hands.length < 2) break
        {
          const eq = equity(
            e.hands.map((x) => x.cards),
            h.board,
          )
          h.equity = Object.fromEntries(e.hands.map((x, i) => [x.seat, eq[i]!]))
        }
        break
      case 'showdown':
        if (!h) break
        for (const x of e.hands) {
          const id = h.seats[x.seat]
          if (!id) continue
          const score = handScore(x.best)
          if (!s.bestHand || score > s.bestHand.score) s.bestHand = { id, score, name: x.name, handNo: h.handNo }
        }
        break
      case 'award': {
        if (!h) break
        const first = h.seats[e.winners[0]?.seat ?? -1]
        const bb = e.amount / Math.max(1, h.bb)
        if (first && (!s.bigPot || bb > s.bigPot.bb)) s.bigPot = { id: first, amount: e.amount, bb, handNo: h.handNo }
        if (e.pot !== 0 || !h.equity) break
        const won = new Set(e.winners.map((w) => w.seat))
        for (const [seatKey, eq] of Object.entries(h.equity)) {
          const seat = Number(seatKey)
          const id = h.seats[seat]
          if (!id) continue
          if (!won.has(seat) && eq >= BAD_BEAT && (!s.badBeat || eq > s.badBeat.equity)) s.badBeat = { id, equity: eq, handNo: h.handNo }
          if (won.has(seat) && won.size === 1 && eq <= SUCKOUT && (!s.suckout || eq < s.suckout.equity)) s.suckout = { id, equity: eq, handNo: h.handNo }
        }
        break
      }
      case 'end':
        if (!h) break
        for (const id of h.vpip) player(s, id).vpip++
        for (const id of h.allin) player(s, id).allins++
        s.hand = null
        break
    }
  }
}

/** Сколько думал над ходом. Только люди: у ботов задержка нарочная. */
export function trackThink(s: GameStats, id: string, ms: number) {
  const p = player(s, id)
  p.thinkMs += Math.max(0, Math.min(ms, 600_000))
  p.decisions++
}

export interface AwardPlayer {
  id: string
  name: string
  color: string
  isBot: boolean
}

/** Номинации по итогам партии, от самых громких к спокойным. */
export function computeAwards(s: GameStats, people: readonly AwardPlayer[]): AwardView[] {
  const who = new Map(people.map((p) => [p.id, p]))
  const out: AwardView[] = []
  const add = (kind: AwardKind, id: string, value: number, extra: Partial<Pick<AwardView, 'bb' | 'hand' | 'handNo'>> = {}) => {
    const p = who.get(id)
    if (!p) return
    out.push({ kind, id, name: p.name, color: p.color, value, bb: extra.bb ?? null, hand: extra.hand ?? null, handNo: extra.handNo ?? null })
  }
  /** Лучший по метрике среди тех, кто прошёл фильтр; при равенстве первый за столом. */
  const best = (score: (p: PlayerStats, id: string) => number | null, dir: 1 | -1): { id: string; value: number } | null => {
    let top: { id: string; value: number } | null = null
    for (const p of people) {
      const st = s.players[p.id]
      if (!st) continue
      const v = score(st, p.id)
      if (v === null) continue
      if (!top || v * dir > top.value * dir) top = { id: p.id, value: v }
    }
    return top
  }

  if (s.badBeat) add('badBeat', s.badBeat.id, s.badBeat.equity, { handNo: s.badBeat.handNo })
  if (s.suckout) add('suckout', s.suckout.id, s.suckout.equity, { handNo: s.suckout.handNo })
  if (s.bestHand && scoreCategory(s.bestHand.score) >= 2) add('bestHand', s.bestHand.id, 0, { hand: s.bestHand.name, handNo: s.bestHand.handNo })
  if (s.bigPot && s.bigPot.bb >= BIG_POT_BB) add('bigPot', s.bigPot.id, s.bigPot.amount, { bb: Math.round(s.bigPot.bb), handNo: s.bigPot.handNo })

  const allins = best((p) => (p.allins >= MIN_ALLINS ? p.allins : null), 1)
  if (allins) add('allins', allins.id, allins.value)

  const aggro = best((p) => (p.hands >= MIN_HANDS && p.aggr >= MIN_AGGR ? p.aggr / p.hands : null), 1)
  if (aggro) add('aggro', aggro.id, s.players[aggro.id]!.aggr)

  const loose = best((p) => (p.hands >= MIN_HANDS && p.vpip / p.hands >= LOOSE ? p.vpip / p.hands : null), 1)
  if (loose) add('loose', loose.id, loose.value)

  const tight = best((p) => (p.hands >= MIN_HANDS && p.vpip / p.hands <= TIGHT ? p.vpip / p.hands : null), -1)
  if (tight) add('tight', tight.id, tight.value)

  const thinker = best((p, id) => {
    if (who.get(id)?.isBot || p.decisions < MIN_DECISIONS) return null
    const avg = p.thinkMs / p.decisions
    return avg >= THINKER_MS ? avg : null
  }, 1)
  if (thinker) add('thinker', thinker.id, thinker.value)

  return out.slice(0, MAX_AWARDS)
}
