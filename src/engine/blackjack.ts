import { fullDeck, rankOf, type Card, type RandomInt } from './cards.ts'
import { EngineError } from './hand.ts'

/** Блэкджек против дилера: шуз из 6 колод, дилер стоит на мягких 17, блэкджек платит 3 к 2. */
export const BJ_DECKS = 6
/** Перетасовка, когда в шузе осталась четверть. */
export const BJ_CUT = Math.round(52 * BJ_DECKS * 0.25)
export const BJ_MAX_SEATS = 7

export type BjResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust'

export interface BjHand {
  cards: Card[]
  bet: number
  doubled: boolean
  fromSplit: boolean
  done: boolean
  result: BjResult | null
  payout: number
}

export interface BjSeat {
  id: string
  seat: number
  hands: BjHand[]
}

export type BjPhase = 'betting' | 'playing' | 'done'

export interface BjRound {
  roundNo: number
  phase: BjPhase
  /** Ставки, сделанные в фазе ставок: id → сумма. */
  bets: Record<string, number>
  seats: BjSeat[]
  dealer: Card[]
  /** Закрытая карта дилера ещё не открыта. */
  holeHidden: boolean
  toAct: { seat: number; hand: number } | null
}

export type BjAction = { type: 'hit' } | { type: 'stand' } | { type: 'double' } | { type: 'split' }

export interface BjLegal {
  hit: boolean
  stand: boolean
  double: boolean
  split: boolean
}

export type BjEvent =
  | { t: 'bj_round'; roundNo: number; shuffled: boolean }
  | { t: 'bj_bet'; seat: number; amount: number }
  | { t: 'bj_card'; to: 'player'; seat: number; hand: number; card: Card }
  | { t: 'bj_card'; to: 'dealer'; card: Card | null }
  | { t: 'bj_act'; seat: number; hand: number; kind: BjAction['type'] }
  | { t: 'bj_reveal'; card: Card }
  | { t: 'bj_result'; seat: number; hand: number; result: BjResult; payout: number; bet: number }
  | { t: 'bj_end'; stacks: { seat: number; stack: number }[] }

/** Сумма руки и мягкая ли она (туз считается за 11). */
export function bjTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0
  let aces = 0
  for (const c of cards) {
    const r = rankOf(c)
    if (r === 14) {
      aces++
      total += 11
    } else total += Math.min(10, r)
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 }
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && bjTotal(cards).total === 21
}

export function newShoe(rand: RandomInt): Card[] {
  const shoe: Card[] = []
  for (let d = 0; d < BJ_DECKS; d++) shoe.push(...fullDeck())
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    const t = shoe[i]!
    shoe[i] = shoe[j]!
    shoe[j] = t
  }
  return shoe
}

export function newRound(roundNo: number): BjRound {
  return { roundNo, phase: 'betting', bets: {}, seats: [], dealer: [], holeHidden: true, toAct: null }
}

function draw(shoe: Card[]): Card {
  const c = shoe.shift()
  if (!c) throw new EngineError('shoe is empty')
  return c
}

/**
 * Раздача: каждому, кто поставил, по две карты, дилеру открытую и закрытую.
 * Стеки уже уменьшены на ставки вызывающим.
 */
export function bjDeal(r: BjRound, players: { id: string; seat: number }[], shoe: Card[]): BjEvent[] {
  const events: BjEvent[] = []
  r.seats = players
    .filter((p) => (r.bets[p.id] ?? 0) > 0)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      id: p.id,
      seat: p.seat,
      hands: [{ cards: [], bet: r.bets[p.id]!, doubled: false, fromSplit: false, done: false, result: null, payout: 0 }],
    }))
  if (r.seats.length === 0) throw new EngineError('no bets')
  r.phase = 'playing'
  for (let pass = 0; pass < 2; pass++) {
    for (const s of r.seats) {
      const card = draw(shoe)
      s.hands[0]!.cards.push(card)
      events.push({ t: 'bj_card', to: 'player', seat: s.seat, hand: 0, card })
    }
    const card = draw(shoe)
    r.dealer.push(card)
    events.push({ t: 'bj_card', to: 'dealer', card: pass === 0 ? card : null })
  }
  for (const s of r.seats) if (isBlackjack(s.hands[0]!.cards)) s.hands[0]!.done = true

  // Дилер заглядывает под карту, если открыт туз или десятка: блэкджек заканчивает раунд сразу.
  const up = rankOf(r.dealer[0]!)
  if ((up === 14 || up >= 10) && isBlackjack(r.dealer)) {
    for (const s of r.seats) for (const h of s.hands) h.done = true
    events.push(...dealerPlay(r, shoe))
    return events
  }
  advance(r, shoe, events)
  return events
}

export function bjLegal(r: BjRound, seat: number, stack: number): BjLegal | null {
  if (r.phase !== 'playing' || !r.toAct || r.toAct.seat !== seat) return null
  const s = r.seats.find((x) => x.seat === seat)!
  const h = s.hands[r.toAct.hand]!
  const two = h.cards.length === 2
  const splitAces = h.fromSplit && rankOf(h.cards[0]!) === 14
  return {
    hit: !splitAces,
    stand: true,
    double: two && !splitAces && stack >= h.bet,
    split: two && s.hands.length === 1 && rankOf(h.cards[0]!) === rankOf(h.cards[1]!) && stack >= h.bet,
  }
}

/** Ход игрока. Возвращает события и сколько фишек дополнительно ушло из стека (удвоение, сплит). */
export function bjAct(r: BjRound, seat: number, stack: number, action: BjAction, shoe: Card[]): { events: BjEvent[]; extra: number } {
  const legal = bjLegal(r, seat, stack)
  if (!legal) throw new EngineError('not your turn')
  if (!legal[action.type]) throw new EngineError(`cannot ${action.type}`)
  const s = r.seats.find((x) => x.seat === seat)!
  const hi = r.toAct!.hand
  const h = s.hands[hi]!
  const events: BjEvent[] = [{ t: 'bj_act', seat, hand: hi, kind: action.type }]
  let extra = 0

  switch (action.type) {
    case 'hit': {
      const card = draw(shoe)
      h.cards.push(card)
      events.push({ t: 'bj_card', to: 'player', seat, hand: hi, card })
      if (bjTotal(h.cards).total >= 21) h.done = true
      break
    }
    case 'stand':
      h.done = true
      break
    case 'double': {
      extra = h.bet
      h.bet *= 2
      h.doubled = true
      const card = draw(shoe)
      h.cards.push(card)
      events.push({ t: 'bj_card', to: 'player', seat, hand: hi, card })
      h.done = true
      break
    }
    case 'split': {
      extra = h.bet
      const second: BjHand = { cards: [h.cards.pop()!], bet: h.bet, doubled: false, fromSplit: true, done: false, result: null, payout: 0 }
      h.fromSplit = true
      s.hands.push(second)
      const aces = rankOf(h.cards[0]!) === 14
      for (const [i, hand] of [h, second].entries()) {
        const card = draw(shoe)
        hand.cards.push(card)
        events.push({ t: 'bj_card', to: 'player', seat, hand: i === 0 ? hi : s.hands.length - 1, card })
        // Разделённые тузы получают по одной карте и сразу стоят.
        if (aces || bjTotal(hand.cards).total === 21) hand.done = true
      }
      break
    }
  }
  advance(r, shoe, events)
  return { events, extra }
}

/** Следующая незавершённая рука по порядку мест; если таких нет, играет дилер. */
function advance(r: BjRound, shoe: Card[], events: BjEvent[]) {
  for (const s of r.seats) {
    const hi = s.hands.findIndex((h) => !h.done)
    if (hi >= 0) {
      r.toAct = { seat: s.seat, hand: hi }
      return
    }
  }
  r.toAct = null
  events.push(...dealerPlay(r, shoe))
}

function dealerPlay(r: BjRound, shoe: Card[]): BjEvent[] {
  const events: BjEvent[] = []
  r.holeHidden = false
  events.push({ t: 'bj_reveal', card: r.dealer[1]! })
  const live = r.seats.some((s) => s.hands.some((h) => bjTotal(h.cards).total <= 21 && !(isBlackjack(h.cards) && !h.fromSplit)))
  if (live && !isBlackjack(r.dealer)) {
    while (bjTotal(r.dealer).total < 17) {
      const card = draw(shoe)
      r.dealer.push(card)
      events.push({ t: 'bj_card', to: 'dealer', card })
    }
  }
  const dealer = bjTotal(r.dealer).total
  const dealerBj = isBlackjack(r.dealer)
  for (const s of r.seats) {
    s.hands.forEach((h, i) => {
      const total = bjTotal(h.cards).total
      const natural = isBlackjack(h.cards) && !h.fromSplit
      const [result, payout] = settleHand(h, total, natural, dealer, dealerBj)
      h.result = result
      h.payout = payout
      h.done = true
      events.push({ t: 'bj_result', seat: s.seat, hand: i, result, payout, bet: h.bet })
    })
  }
  r.phase = 'done'
  return events
}

function settleHand(h: BjHand, total: number, natural: boolean, dealer: number, dealerBj: boolean): [BjResult, number] {
  if (total > 21) return ['bust', 0]
  if (natural && !dealerBj) return ['blackjack', h.bet + Math.floor((h.bet * 3) / 2)]
  if (dealerBj) return natural ? ['push', h.bet] : ['lose', 0]
  if (dealer > 21 || total > dealer) return ['win', h.bet * 2]
  if (total === dealer) return ['push', h.bet]
  return ['lose', 0]
}

/** Простая базовая стратегия для ботов. */
export function bjBotAction(cards: Card[], dealerUp: Card, legal: BjLegal): BjAction {
  const { total, soft } = bjTotal(cards)
  const up = Math.min(10, rankOf(dealerUp) === 14 ? 11 : rankOf(dealerUp))
  const pair = cards.length === 2 && rankOf(cards[0]!) === rankOf(cards[1]!) ? rankOf(cards[0]!) : 0
  if (legal.split && (pair === 14 || pair === 8)) return { type: 'split' }
  if (legal.double && !soft && (total === 11 || (total === 10 && up < 10))) return { type: 'double' }
  if (soft) return total <= 17 || (total === 18 && up >= 9) ? hit(legal) : { type: 'stand' }
  if (total <= 11) return hit(legal)
  if (total === 12) return up >= 4 && up <= 6 ? { type: 'stand' } : hit(legal)
  if (total <= 16) return up >= 7 ? hit(legal) : { type: 'stand' }
  return { type: 'stand' }
}

function hit(legal: BjLegal): BjAction {
  return legal.hit ? { type: 'hit' } : { type: 'stand' }
}
