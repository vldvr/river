import { bjTotal, type BjResult } from '../../../engine/index.ts'
import type { BjView, TableView, ViewEvent } from '../../../protocol/index.ts'
import { sound } from '../audio/sound'
import { chips } from '../lib/format'
import { native } from '../lib/native'
import { useApp } from '../store/app'
import { useBj } from '../store/bjscene'
import { useScene } from '../store/scene'
import { BJ_CARD, DEALER, SHOE, bjCardPos, bjPlaces, dealerCardPos } from '../table/bjGeometry'

type BjEv = Extract<ViewEvent, { t: `bj_${string}` }>

const ACT_LABEL: Record<string, string> = { hit: 'Ещё', stand: 'Хватит', double: 'Удвоение', split: 'Сплит' }
const RESULT: Record<BjResult, (payout: number, bet: number) => { text: string; tone: 'win' | 'lose' | 'plain' }> = {
  blackjack: (p, b) => ({ text: `Блэкджек +${chips(p - b)}`, tone: 'win' }),
  win: (p, b) => ({ text: `+${chips(p - b)}`, tone: 'win' }),
  push: () => ({ text: 'Ничья', tone: 'plain' }),
  lose: () => ({ text: 'Проигрыш', tone: 'lose' }),
  bust: () => ({ text: 'Перебор', tone: 'lose' }),
}

export function bjPlacesFor(view: TableView, you: string | null) {
  const seats = view.players.filter((p) => p.seat !== null && p.status !== 'left').map((p) => p.seat!)
  const hero = view.players.find((p) => p.id === you)?.seat ?? null
  return bjPlaces(seats, hero)
}

function clone(bj: BjView): BjView {
  return structuredClone(bj)
}

/** Один шаг анимации раунда блэкджека. Возвращает, сколько ждать (мс, до учёта скорости). */
export function bjStep(e: BjEv, view: TableView, k: number): number {
  const S = useBj.getState()
  const you = useApp.getState().you
  const places = bjPlacesFor(view, you)
  const flight = useScene.getState().addFlight
  const cur = S.bj ? clone(S.bj) : null

  switch (e.t) {
    case 'bj_round': {
      useBj.setState({ bj: view.bj ? { ...clone(view.bj), seats: view.bj.seats.map((s) => ({ ...s, bet: null, hands: [] })), dealer: { cards: [], total: null, soft: false } } : null, labels: {}, toAct: null, turnEndsAt: null })
      if (e.shuffled) sound.play('card-shuffle', { volume: 0.6 })
      return 500
    }
    case 'bj_bet': {
      const p = places.get(e.seat)
      if (p) flight({ kind: 'chips', from: p.pos, to: p.bet, amount: e.amount, delay: 0, duration: 320 * k })
      sound.play('chipsStack', { volume: 0.7 })
      if (cur) {
        const seat = cur.seats.find((s) => s.seat === e.seat)
        if (seat) seat.bet = e.amount
        else cur.seats.push({ seat: e.seat, id: '', bet: e.amount, hands: [] })
        setTimeout(() => useBj.setState({ bj: cur }), 300 * k)
      }
      return 320
    }
    case 'bj_card': {
      if (!cur) return 0
      if (e.to === 'dealer') {
        const i = cur.dealer.cards.length
        flight({ kind: 'card', from: SHOE, to: dealerCardPos(i, i + 1), amount: 0, delay: 0, duration: 300 * k, rotate: 0, small: true })
        sound.play('deal', { volume: 0.6 })
        cur.dealer.cards.push(e.card)
        const open = cur.dealer.cards.filter((c): c is string => !!c)
        const t = bjTotal(open)
        cur.dealer.total = open.length ? t.total : null
        cur.dealer.soft = t.soft
      } else {
        const seat = cur.seats.find((s) => s.seat === e.seat)
        if (!seat) return 0
        // Первая карта раунда: ставка превращается в руку.
        if (seat.hands.length === 0) seat.hands.push(emptyHand(seat.bet ?? 0))
        while (seat.hands.length <= e.hand) seat.hands.push(emptyHand(seat.hands[0]!.bet))
        const hand = seat.hands[e.hand]!
        const p = places.get(e.seat)
        if (p) flight({ kind: 'card', from: SHOE, to: bjCardPos(p, e.hand, seat.hands.length, hand.cards.length), amount: 0, delay: 0, duration: 300 * k, small: true })
        sound.play('deal', { volume: 0.6 })
        hand.cards.push(e.card)
        Object.assign(hand, bjTotal(hand.cards))
      }
      setTimeout(() => useBj.setState({ bj: cur }), 290 * k)
      return 340
    }
    case 'bj_act': {
      const labels = { ...S.labels, [`${e.seat}:${e.hand}`]: { text: ACT_LABEL[e.kind] ?? '', tone: 'plain' as const } }
      if (cur && (e.kind === 'split' || e.kind === 'double')) {
        const seat = cur.seats.find((s) => s.seat === e.seat)!
        const hand = seat.hands[e.hand]!
        const p = places.get(e.seat)
        if (p) flight({ kind: 'chips', from: p.pos, to: p.bet, amount: hand.bet, delay: 0, duration: 320 * k })
        sound.play('chipsStack', { volume: 0.7 })
        if (e.kind === 'double') {
          hand.bet *= 2
          hand.doubled = true
        } else {
          const moved = hand.cards.pop()!
          Object.assign(hand, bjTotal(hand.cards))
          seat.hands.push({ ...emptyHand(hand.bet), cards: [moved], ...bjTotal([moved]) })
        }
      } else if (e.kind === 'stand') sound.play('knock', { volume: 0.6 })
      useBj.setState({ labels, toAct: null, turnEndsAt: null, ...(cur ? { bj: cur } : {}) })
      return 260
    }
    case 'bj_reveal': {
      if (cur) {
        cur.dealer.cards[1] = e.card
        const t = bjTotal(cur.dealer.cards.filter((c): c is string => !!c))
        cur.dealer.total = t.total
        cur.dealer.soft = t.soft
        useBj.setState({ bj: cur })
      }
      sound.play('place', { volume: 0.7 })
      return 650
    }
    case 'bj_result': {
      const p = places.get(e.seat)
      const label = RESULT[e.result](e.payout, e.bet)
      if (p && e.payout > e.bet) flight({ kind: 'chips', from: DEALER, to: p.bet, amount: e.payout - e.bet, delay: 0, duration: 420 * k })
      if (p && e.payout === 0) flight({ kind: 'chips', from: p.bet, to: { x: DEALER.x, y: DEALER.y - BJ_CARD.h }, amount: e.bet, delay: 0, duration: 420 * k })
      if (e.payout > e.bet) sound.play(e.result === 'blackjack' ? 'win' : 'chipsHandle', { volume: 0.7 })
      else if (e.payout === 0) sound.play('chipsCollide', { volume: 0.5 })
      if (cur) {
        const hand = cur.seats.find((s) => s.seat === e.seat)?.hands[e.hand]
        if (hand) {
          hand.result = e.result
          hand.payout = e.payout
        }
      }
      useBj.setState({ labels: { ...useBj.getState().labels, [`${e.seat}:${e.hand}`]: label }, ...(cur ? { bj: cur } : {}) })
      return 420
    }
    case 'bj_turn': {
      const heroSeat = view.players.find((p) => p.id === you)?.seat
      if (e.seat === heroSeat || (e.seat === -1 && view.bj?.you.canBet)) {
        if (useApp.getState().settings.turnSound) sound.play('turn', { volume: 0.55 })
        native?.flash(true)
      }
      useBj.setState({ toAct: e.seat >= 0 ? { seat: e.seat, hand: e.hand } : null, turnTotal: e.totalMs })
      return 0
    }
    case 'bj_end':
      return 400
  }
  return 0
}

function emptyHand(bet: number) {
  return { cards: [] as string[], bet, total: 0, soft: false, doubled: false, done: false, result: null, payout: 0 }
}

/** Итоговое состояние после пачки событий. */
export function bjApplyView(view: TableView, receivedAt: number) {
  const prev = useBj.getState()
  const sameRound = prev.bj?.roundNo === view.bj?.roundNo
  useBj.setState({
    bj: view.bj ? clone(view.bj) : null,
    labels: sameRound ? prev.labels : {},
    toAct: view.bj?.toAct ?? null,
    turnEndsAt: view.turn && !view.paused ? receivedAt + view.turn.remainingMs : null,
    turnTotal: view.turn?.totalMs ?? 1,
  })
}
