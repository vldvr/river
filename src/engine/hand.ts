import type { Card } from './cards.ts'
import { evaluateBest } from './evaluator.ts'
import { handName } from './names.ts'
import { buildPots, splitAmount } from './pots.ts'

export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise'

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Бет или рейз до суммы `to` на этой улице. */
  | { type: 'raise'; to: number }
  | { type: 'allin' }

export interface Blinds {
  sb: number
  bb: number
  ante: number
}

export interface HandPlayer {
  id: string
  seat: number
  /** Фишки за спиной, без текущей ставки. */
  stack: number
  startStack: number
  hole: Card[]
  /** Ставка на текущей улице. */
  bet: number
  /** Всё вложенное за раздачу, включая анте и текущую ставку. */
  committed: number
  folded: boolean
  allIn: boolean
  /** Ходил ли с момента последнего полного рейза. */
  acted: boolean
  /** Уровень ставки, на котором ходил последний раз. */
  actedLevel: number
}

export interface HandState {
  handNo: number
  players: HandPlayer[]
  button: number
  sbSeat: number | null
  bbSeat: number
  blinds: Blinds
  street: Street
  board: Card[]
  deck: Card[]
  currentBet: number
  /** Размер последнего полного рейза: минимальный шаг следующего. */
  minRaise: number
  toAct: number | null
  lastAggressor: number | null
  revealed: boolean
  done: boolean
}

export interface ShowdownHand {
  seat: number
  name: string
  best: Card[]
}

export type HandEvent =
  | {
      t: 'start'
      handNo: number
      button: number
      sbSeat: number | null
      bbSeat: number
      blinds: Blinds
      seats: { seat: number; id: string; stack: number }[]
    }
  | { t: 'post'; seat: number; kind: 'ante' | 'sb' | 'bb'; amount: number; allIn: boolean }
  | { t: 'deal'; order: number[] }
  | { t: 'act'; seat: number; kind: ActionKind; added: number; bet: number; allIn: boolean }
  | { t: 'uncalled'; seat: number; amount: number }
  | { t: 'collect'; total: number }
  | { t: 'board'; street: Street; cards: Card[] }
  | { t: 'reveal'; hands: { seat: number; cards: Card[] }[] }
  | { t: 'showdown'; hands: ShowdownHand[] }
  | {
      t: 'award'
      pot: number
      amount: number
      winners: { seat: number; amount: number }[]
      hand: { name: string; best: Card[] } | null
    }
  | { t: 'end'; stacks: { seat: number; stack: number }[] }

export interface LegalActions {
  seat: number
  toCall: number
  callAmount: number
  canCheck: boolean
  canCall: boolean
  canRaise: boolean
  /** Бет (на улице ещё нет ставки) или рейз. */
  isBet: boolean
  minTo: number
  maxTo: number
}

export class EngineError extends Error {}

export interface HandSetup {
  handNo: number
  seats: { id: string; seat: number; stack: number }[]
  button: number
  blinds: Blinds
  deck: Card[]
}

export function startHand(setup: HandSetup): { hand: HandState; events: HandEvent[] } {
  const seats = [...setup.seats].sort((a, b) => a.seat - b.seat)
  if (seats.length < 2) throw new EngineError('need at least 2 players')
  const bIdx = seats.findIndex((s) => s.seat === setup.button)
  if (bIdx < 0) throw new EngineError('button must be dealt in')
  const n = seats.length
  const sbIdx = n === 2 ? bIdx : (bIdx + 1) % n
  const bbIdx = (sbIdx + 1) % n
  const deck = [...setup.deck]

  const h: HandState = {
    handNo: setup.handNo,
    players: seats.map((s) => ({
      id: s.id,
      seat: s.seat,
      stack: s.stack,
      startStack: s.stack,
      hole: [],
      bet: 0,
      committed: 0,
      folded: false,
      allIn: false,
      acted: false,
      actedLevel: 0,
    })),
    button: setup.button,
    sbSeat: seats[sbIdx]!.seat,
    bbSeat: seats[bbIdx]!.seat,
    blinds: { ...setup.blinds },
    street: 'preflop',
    board: [],
    deck,
    currentBet: 0,
    minRaise: setup.blinds.bb,
    toAct: null,
    lastAggressor: null,
    revealed: false,
    done: false,
  }

  const events: HandEvent[] = [
    {
      t: 'start',
      handNo: h.handNo,
      button: h.button,
      sbSeat: h.sbSeat,
      bbSeat: h.bbSeat,
      blinds: { ...h.blinds },
      seats: seats.map((s) => ({ seat: s.seat, id: s.id, stack: s.stack })),
    },
  ]

  if (h.blinds.ante > 0) {
    for (const p of h.players) {
      const amt = Math.min(h.blinds.ante, p.stack)
      if (amt <= 0) continue
      p.stack -= amt
      p.committed += amt
      if (p.stack === 0) p.allIn = true
      events.push({ t: 'post', seat: p.seat, kind: 'ante', amount: amt, allIn: p.allIn })
    }
  }

  postBlind(h, h.players[sbIdx]!, h.blinds.sb, 'sb', events)
  postBlind(h, h.players[bbIdx]!, h.blinds.bb, 'bb', events)
  h.currentBet = h.blinds.bb
  h.minRaise = h.blinds.bb

  const order: number[] = []
  for (let i = 1; i <= n; i++) order.push(h.players[(bIdx + i) % n]!.seat)
  for (let pass = 0; pass < 2; pass++)
    for (const seat of order) playerAt(h, seat).hole.push(draw(h))
  events.push({ t: 'deal', order })

  proceed(h, events, bbIdx)
  return { hand: h, events }
}

function postBlind(h: HandState, p: HandPlayer, size: number, kind: 'sb' | 'bb', events: HandEvent[]) {
  const amt = Math.min(size, p.stack)
  if (amt <= 0) return
  p.stack -= amt
  p.bet += amt
  p.committed += amt
  if (p.stack === 0) p.allIn = true
  events.push({ t: 'post', seat: p.seat, kind, amount: amt, allIn: p.allIn })
}

function draw(h: HandState): Card {
  const c = h.deck.shift()
  if (!c) throw new EngineError('deck is empty')
  return c
}

export function playerAt(h: HandState, seat: number): HandPlayer {
  const p = h.players.find((x) => x.seat === seat)
  if (!p) throw new EngineError(`no player at seat ${seat}`)
  return p
}

function idxOf(h: HandState, seat: number): number {
  return h.players.findIndex((p) => p.seat === seat)
}

export function potTotal(h: HandState): number {
  return h.players.reduce((s, p) => s + p.committed, 0)
}

function othersCanAct(h: HandState, p: HandPlayer): boolean {
  return h.players.some((o) => o !== p && !o.folded && !o.allIn)
}

function needsAction(h: HandState, p: HandPlayer): boolean {
  if (p.folded || p.allIn) return false
  if (p.bet < h.currentBet) return true
  return !p.acted && othersCanAct(h, p)
}

function findNext(h: HandState, fromIdx: number): number | null {
  const n = h.players.length
  for (let i = 1; i <= n; i++) {
    const idx = (fromIdx + i) % n
    if (needsAction(h, h.players[idx]!)) return idx
  }
  return null
}

export function legalActions(h: HandState, seat: number): LegalActions {
  const p = playerAt(h, seat)
  const toCall = Math.max(0, h.currentBet - p.bet)
  const maxTo = p.bet + p.stack
  const reopened = !p.acted || h.currentBet - p.actedLevel >= h.minRaise
  const canRaise = p.stack > toCall && reopened && othersCanAct(h, p)
  return {
    seat,
    toCall,
    callAmount: Math.min(toCall, p.stack),
    canCheck: toCall === 0,
    canCall: toCall > 0,
    canRaise,
    isBet: h.currentBet === 0,
    minTo: Math.min(h.currentBet + h.minRaise, maxTo),
    maxTo,
  }
}

export function act(h: HandState, seat: number, action: PlayerAction): HandEvent[] {
  if (h.done) throw new EngineError('hand is over')
  if (h.toAct !== seat) throw new EngineError('not your turn')
  const p = playerAt(h, seat)
  const la = legalActions(h, seat)
  const events: HandEvent[] = []

  let a = action
  if (a.type === 'allin') {
    if (p.stack <= la.toCall) a = { type: 'call' }
    else if (la.canRaise) a = { type: 'raise', to: la.maxTo }
    else throw new EngineError('cannot go all-in here')
  }

  switch (a.type) {
    case 'fold': {
      p.folded = true
      p.acted = true
      events.push({ t: 'act', seat, kind: 'fold', added: 0, bet: p.bet, allIn: false })
      break
    }
    case 'check': {
      if (!la.canCheck) throw new EngineError('cannot check')
      p.acted = true
      p.actedLevel = h.currentBet
      events.push({ t: 'act', seat, kind: 'check', added: 0, bet: p.bet, allIn: false })
      break
    }
    case 'call': {
      if (!la.canCall) throw new EngineError('nothing to call')
      const added = la.callAmount
      pay(p, added)
      p.acted = true
      p.actedLevel = h.currentBet
      events.push({ t: 'act', seat, kind: 'call', added, bet: p.bet, allIn: p.allIn })
      break
    }
    case 'raise': {
      if (!la.canRaise) throw new EngineError('cannot raise')
      const to = a.to
      if (!Number.isInteger(to)) throw new EngineError('amount must be an integer')
      if (to > la.maxTo) throw new EngineError('not enough chips')
      if (to < la.minTo) throw new EngineError(`minimum is ${la.minTo}`)
      if (to <= h.currentBet) throw new EngineError('raise must exceed current bet')
      const kind: ActionKind = h.currentBet === 0 ? 'bet' : 'raise'
      const increment = to - h.currentBet
      if (increment >= h.minRaise) h.minRaise = increment
      h.currentBet = to
      const added = to - p.bet
      pay(p, added)
      p.acted = true
      p.actedLevel = to
      h.lastAggressor = seat
      events.push({ t: 'act', seat, kind, added, bet: p.bet, allIn: p.allIn })
      break
    }
  }

  proceed(h, events, idxOf(h, seat))
  return events
}

function pay(p: HandPlayer, amount: number) {
  p.stack -= amount
  p.bet += amount
  p.committed += amount
  if (p.stack === 0) p.allIn = true
}

function proceed(h: HandState, events: HandEvent[], fromIdx: number) {
  h.toAct = null
  if (h.players.filter((p) => !p.folded).length === 1) {
    endStreet(h, events)
    return
  }
  const next = findNext(h, fromIdx)
  if (next !== null) {
    h.toAct = h.players[next]!.seat
    return
  }
  endStreet(h, events)
}

function endStreet(h: HandState, events: HandEvent[]) {
  returnUncalled(h, events)
  if (h.players.some((p) => p.bet > 0)) {
    for (const p of h.players) p.bet = 0
    events.push({ t: 'collect', total: potTotal(h) })
  }

  const live = h.players.filter((p) => !p.folded)
  if (live.length === 1) {
    awardUncontested(h, live[0]!, events)
    return
  }

  for (;;) {
    if (h.street === 'river') {
      showdown(h, events)
      return
    }
    const canBet = live.filter((p) => !p.allIn).length >= 2
    if (!canBet && !h.revealed) {
      h.revealed = true
      events.push({ t: 'reveal', hands: showOrder(h).map((p) => ({ seat: p.seat, cards: [...p.hole] })) })
    }
    dealStreet(h, events)
    if (canBet) {
      const next = findNext(h, idxOf(h, h.button))
      if (next !== null) {
        h.toAct = h.players[next]!.seat
        return
      }
    }
  }
}

function dealStreet(h: HandState, events: HandEvent[]) {
  draw(h) // сжигаем
  const count = h.street === 'preflop' ? 3 : 1
  const cards: Card[] = []
  for (let i = 0; i < count; i++) cards.push(draw(h))
  h.board.push(...cards)
  h.street = h.street === 'preflop' ? 'flop' : h.street === 'flop' ? 'turn' : 'river'
  h.currentBet = 0
  h.minRaise = h.blinds.bb
  h.lastAggressor = null
  for (const p of h.players) {
    p.acted = false
    p.actedLevel = 0
  }
  events.push({ t: 'board', street: h.street, cards })
}

function returnUncalled(h: HandState, events: HandEvent[]) {
  const sorted = [...h.players].sort((a, b) => b.bet - a.bet)
  const top = sorted[0]
  const second = sorted[1]
  if (!top || !second || top.bet <= second.bet) return
  const amount = top.bet - second.bet
  top.bet -= amount
  top.committed -= amount
  top.stack += amount
  if (top.stack > 0) top.allIn = false
  events.push({ t: 'uncalled', seat: top.seat, amount })
}

/** Порядок от первого слева от баттона. */
function fromButton(h: HandState): HandPlayer[] {
  const b = idxOf(h, h.button)
  const n = h.players.length
  const out: HandPlayer[] = []
  for (let i = 1; i <= n; i++) out.push(h.players[(b + i) % n]!)
  return out
}

/** Кто открывается первым: последний агрессор, иначе первый слева от баттона. */
function showOrder(h: HandState): HandPlayer[] {
  const order = fromButton(h).filter((p) => !p.folded)
  const i = h.lastAggressor === null ? -1 : order.findIndex((p) => p.seat === h.lastAggressor)
  return i <= 0 ? order : [...order.slice(i), ...order.slice(0, i)]
}

function showdown(h: HandState, events: HandEvent[]) {
  const order = showOrder(h)
  if (!h.revealed) {
    h.revealed = true
    events.push({ t: 'reveal', hands: order.map((p) => ({ seat: p.seat, cards: [...p.hole] })) })
  }
  const values = new Map(order.map((p) => [p.seat, evaluateBest([...p.hole, ...h.board])]))
  events.push({
    t: 'showdown',
    hands: order.map((p) => {
      const v = values.get(p.seat)!
      return { seat: p.seat, name: handName(v), best: v.cards }
    }),
  })

  const pots = buildPots(h.players.map((p) => ({ seat: p.seat, amount: p.committed, folded: p.folded })))
  const posOrder = fromButton(h).map((p) => p.seat)
  pots.forEach((pot, index) => {
    const best = Math.max(...pot.eligible.map((s) => values.get(s)!.score))
    const winners = posOrder.filter((s) => pot.eligible.includes(s) && values.get(s)!.score === best)
    const shares = splitAmount(pot.amount, winners)
    for (const [seat, amt] of shares) playerAt(h, seat).stack += amt
    const v = values.get(winners[0]!)!
    events.push({
      t: 'award',
      pot: index,
      amount: pot.amount,
      winners: winners.map((seat) => ({ seat, amount: shares.get(seat)! })),
      hand: { name: handName(v), best: v.cards },
    })
  })
  finish(h, events)
}

function awardUncontested(h: HandState, winner: HandPlayer, events: HandEvent[]) {
  const amount = potTotal(h)
  winner.stack += amount
  events.push({ t: 'award', pot: 0, amount, winners: [{ seat: winner.seat, amount }], hand: null })
  finish(h, events)
}

function finish(h: HandState, events: HandEvent[]) {
  h.done = true
  h.toAct = null
  for (const p of h.players) {
    p.bet = 0
    p.committed = 0
  }
  events.push({ t: 'end', stacks: h.players.map((p) => ({ seat: p.seat, stack: p.stack })) })
}
