import type { TableView, ViewEvent } from '../../../protocol/index.ts'
import { chips } from '../lib/format'
import { useApp } from '../store/app'

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
const STREET: Record<string, string> = { flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' }

let seatIds = new Map<number, string>()
let hand = 0

function cardText(c: string) {
  return `${c[0] === 'T' ? '10' : c[0]}${SUIT[c[1]!]}`
}

function name(view: TableView, seat: number) {
  const id = seatIds.get(seat)
  return view.players.find((p) => p.id === id)?.name ?? view.results.find((r) => r.id === id)?.name ?? 'Игрок'
}

/** Строчка в ленту раздач для события. */
export function logEvent(e: ViewEvent, view: TableView) {
  const push = useApp.getState().pushLog
  switch (e.t) {
    case 'start':
      hand = e.handNo
      seatIds = new Map(e.seats.map((s) => [s.seat, s.id]))
      push(hand, `Раздача ${e.handNo}, блайнды ${chips(e.blinds.sb)}/${chips(e.blinds.bb)}`, true)
      return
    case 'post':
      if (e.kind !== 'ante') push(hand, `${name(view, e.seat)}: ${e.kind === 'sb' ? 'малый' : 'большой'} блайнд ${chips(e.amount)}`)
      return
    case 'act': {
      const who = name(view, e.seat)
      const tail = e.allIn ? ' (олл-ин)' : ''
      const text =
        e.kind === 'fold'
          ? 'фолд'
          : e.kind === 'check'
            ? 'чек'
            : e.kind === 'call'
              ? `колл ${chips(e.added)}`
              : e.kind === 'bet'
                ? `бет ${chips(e.bet)}`
                : `рейз до ${chips(e.bet)}`
      push(hand, `${who}: ${text}${tail}`)
      return
    }
    case 'uncalled':
      push(hand, `${name(view, e.seat)}: возврат ${chips(e.amount)}`)
      return
    case 'board':
      push(hand, `${STREET[e.street]}: ${e.cards.map(cardText).join(' ')}`, true)
      return
    case 'showdown':
      for (const h of e.hands) push(hand, `${name(view, h.seat)}: ${h.name.toLowerCase()}`)
      return
    case 'award':
      for (const w of e.winners) push(hand, `${name(view, w.seat)} забирает ${chips(w.amount)}${e.hand ? `, ${e.hand.name.toLowerCase()}` : ''}`, true)
      return
    case 'timeout':
      push(hand, `${name(view, e.seat)}: время вышло`)
      return
    case 'show':
      push(hand, `${name(view, e.seat)} показывает ${e.cards.map(cardText).join(' ')}`)
      return
  }
}
