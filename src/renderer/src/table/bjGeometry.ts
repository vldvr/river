import type { Pt } from '../store/scene'

export const DEALER: Pt = { x: 800, y: 196 }
export const SHOE: Pt = { x: 1150, y: 176 }
export const BJ_CARD = { w: 78, h: 109 }

// Места по нижней дуге стола; крайние подняты, чтобы не уходить под панель ставок.
const SLOTS: Pt[] = [
  { x: 236, y: 476 },
  { x: 382, y: 628 },
  { x: 584, y: 722 },
  { x: 800, y: 752 },
  { x: 1016, y: 722 },
  { x: 1218, y: 628 },
  { x: 1364, y: 476 },
]

export interface BjPlace {
  seat: number
  pos: Pt
  bet: Pt
  cards: Pt
  hero: boolean
}

/** Места слева направо в порядке номеров (так же идёт раздача), группа по центру дуги. */
export function bjPlaces(seats: number[], heroSeat: number | null): Map<number, BjPlace> {
  const sorted = [...seats].sort((a, b) => a - b).slice(0, 7)
  const n = sorted.length
  const start = Math.max(0, 3 - Math.floor((n - 1) / 2))
  const out = new Map<number, BjPlace>()
  sorted.forEach((seat, i) => {
    const pos = SLOTS[Math.min(6, start + i)]!
    // Руки лежат прямо над местом, чуть сдвинуты к центру: так соседние не наезжают друг на друга.
    const lean = (DEALER.x - pos.x) * 0.1
    out.set(seat, {
      seat,
      pos,
      bet: { x: pos.x + lean * 0.5, y: pos.y - 104 },
      cards: { x: pos.x + lean, y: pos.y - 214 },
      hero: seat === heroSeat,
    })
  })
  return out
}

/** Где лежит карта № i руки № hand из handsCount. */
export function bjCardPos(place: BjPlace, hand: number, handsCount: number, i: number): Pt {
  const spread = handsCount > 1 ? (hand - (handsCount - 1) / 2) * 96 : 0
  return { x: place.cards.x + spread + i * 20 - 10, y: place.cards.y - i * 10 }
}

export function dealerCardPos(i: number, count: number): Pt {
  const gap = BJ_CARD.w * 0.62
  return { x: DEALER.x + (i - (count - 1) / 2) * gap, y: DEALER.y }
}
