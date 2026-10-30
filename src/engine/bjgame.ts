import { cryptoRandomInt, type RandomInt } from './cards.ts'
import { BJ_CUT, bjAct, bjDeal, bjLegal, newRound, newShoe, type BjAction, type BjEvent, type BjLegal, type BjPhase } from './blackjack.ts'
import { EngineError } from './hand.ts'
import { findPlayer, seatedPlayers, type GameEvent, type GameState } from './game.ts'

export type BjGameEvent = BjEvent | Extract<GameEvent, { t: 'bust' }>

export const bjMinBet = (g: GameState) => g.config.bigBlind
export const bjMaxBet = (g: GameState) => g.config.bigBlind * 100

function bettors(g: GameState) {
  return seatedPlayers(g).filter((p) => p.status === 'active' && p.stack >= bjMinBet(g))
}

export function bjCanStart(g: GameState): boolean {
  return (!g.bj || g.bj.phase === 'done') && bettors(g).length > 0
}

/** Новый раунд: фаза ставок. Шуз перетасовывается, когда в нём осталась четверть. */
export function bjBegin(g: GameState, rand: RandomInt = cryptoRandomInt): BjEvent[] {
  if (!bjCanStart(g)) throw new EngineError('cannot start a round')
  if (g.startedAt === null) g.startedAt = 0
  const shuffled = g.shoe.length < BJ_CUT
  if (shuffled) g.shoe = newShoe(rand)
  g.handNo += 1
  g.bj = newRound(g.handNo)
  return [{ t: 'bj_round', roundNo: g.handNo, shuffled }]
}

export function bjBet(g: GameState, id: string, amount: number): BjEvent[] {
  const r = g.bj
  if (!r || r.phase !== 'betting') throw new EngineError('betting is closed')
  const p = findPlayer(g, id)
  if (!p || p.status !== 'active') throw new EngineError('not playing')
  if (!Number.isInteger(amount) || amount < bjMinBet(g) || amount > Math.min(bjMaxBet(g), p.stack)) throw new EngineError('bad bet')
  r.bets[id] = amount
  return [{ t: 'bj_bet', seat: p.seat, amount }]
}

/** Все, кто может ставить, уже поставили. */
export function bjAllBet(g: GameState): boolean {
  const r = g.bj
  return !!r && r.phase === 'betting' && bettors(g).every((p) => (r.bets[p.id] ?? 0) > 0)
}

/** Закрываем ставки и раздаём. Если никто не поставил, раунд пропадает. */
export function bjCloseBets(g: GameState): BjGameEvent[] {
  const r = g.bj
  if (!r || r.phase !== 'betting') throw new EngineError('betting is closed')
  const players = bettors(g).filter((p) => (r.bets[p.id] ?? 0) > 0)
  if (players.length === 0) {
    r.phase = 'done'
    return []
  }
  for (const p of players) p.stack -= r.bets[p.id]!
  const events: BjGameEvent[] = bjDeal(r, players, g.shoe)
  // Дилерский блэкджек заканчивает раунд прямо в раздаче.
  if ((r.phase as BjPhase) === 'done') events.push(...settle(g))
  return events
}

export function bjLegalFor(g: GameState, id: string): BjLegal | null {
  const r = g.bj
  const p = findPlayer(g, id)
  if (!r || !p) return null
  return bjLegal(r, p.seat, p.stack)
}

export function bjApply(g: GameState, id: string, action: BjAction): BjGameEvent[] {
  const r = g.bj
  const p = findPlayer(g, id)
  if (!r || !p) throw new EngineError('no round')
  const { events, extra } = bjAct(r, p.seat, p.stack, action, g.shoe)
  p.stack -= extra
  const out: BjGameEvent[] = [...events]
  if (r.phase === 'done') out.push(...settle(g))
  return out
}

function settle(g: GameState): BjGameEvent[] {
  const r = g.bj!
  const events: BjGameEvent[] = []
  for (const s of r.seats) {
    const p = findPlayer(g, s.id)
    if (p) p.stack += s.hands.reduce((sum, h) => sum + h.payout, 0)
  }
  events.push({ t: 'bj_end', stacks: r.seats.map((s) => ({ seat: s.seat, stack: findPlayer(g, s.id)?.stack ?? 0 })) })
  for (const p of seatedPlayers(g)) {
    if (p.status === 'active' && p.stack < bjMinBet(g)) {
      p.status = 'busted'
      events.push({ t: 'bust', id: p.id, seat: p.seat, place: null })
    }
  }
  return events
}

/** Сколько фишек в игре: стеки плюс ставки на столе. */
export function bjChips(g: GameState): number {
  const r = g.bj
  const stacks = g.players.filter((p) => p.status !== 'left').reduce((s, p) => s + p.stack, 0)
  if (!r || r.phase !== 'playing') return stacks
  return stacks + r.seats.reduce((s, x) => s + x.hands.reduce((a, h) => a + h.bet, 0), 0)
}
