import type { Pt } from '../store/scene'

/** Сцена рисуется в этих координатах и масштабируется под окно целиком. */
export const STAGE = { w: 1600, h: 900 }
export const CENTER: Pt = { x: 800, y: 430 }
export const FELT = { cx: 800, cy: 430, rx: 600, ry: 282 }
/** Откуда вылетают карты: место дилера над доской. */
export const DECK: Pt = { x: 800, y: 268 }
export const POT: Pt = { x: 800, y: 330 }
export const BOARD_Y = 438
export const BOARD_CARD = { w: 92, h: 128, gap: 12 }
export const HERO_CARD = { w: 100, h: 140 }
export const SMALL_CARD = { w: 50, h: 70 }

const SLOT: Record<string, Pt> = {
  S0: { x: 800, y: 808 },
  S1: { x: 462, y: 742 },
  S2: { x: 178, y: 590 },
  S3: { x: 170, y: 292 },
  S4: { x: 486, y: 118 },
  TC: { x: 800, y: 96 },
  S5: { x: 1114, y: 118 },
  S6: { x: 1430, y: 292 },
  S7: { x: 1422, y: 590 },
  S8: { x: 1138, y: 742 },
  L: { x: 132, y: 440 },
  R: { x: 1468, y: 440 },
}

/** Раскладка мест по числу игроков, по часовой стрелке от нижнего (своего) места. */
const LAYOUTS: Record<number, string[]> = {
  1: ['S0'],
  2: ['S0', 'TC'],
  3: ['S0', 'S3', 'S6'],
  4: ['S0', 'L', 'TC', 'R'],
  5: ['S0', 'S2', 'S4', 'S5', 'S7'],
  6: ['S0', 'S2', 'S3', 'TC', 'S6', 'S7'],
  7: ['S0', 'S1', 'S3', 'S4', 'S5', 'S6', 'S8'],
  8: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
  9: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'],
}

export interface SeatPlace {
  seat: number
  pos: Pt
  /** Куда кладутся ставки. */
  bet: Pt
  /** Где лежат закрытые карты соседа. */
  cards: Pt
  /** Фишка дилера. */
  button: Pt
  hero: boolean
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/**
 * Позиции занятых мест. Свой игрок всегда снизу по центру, остальные идут
 * по часовой стрелке в порядке номеров мест.
 */
export function seatPlaces(seats: number[], heroSeat: number | null): Map<number, SeatPlace> {
  const sorted = [...seats].sort((a, b) => a - b)
  const n = Math.min(9, sorted.length)
  const start = heroSeat !== null && sorted.includes(heroSeat) ? sorted.indexOf(heroSeat) : 0
  const layout = LAYOUTS[n] ?? LAYOUTS[9]!
  const out = new Map<number, SeatPlace>()
  for (let i = 0; i < n; i++) {
    const seat = sorted[(start + i) % n]!
    const pos = SLOT[layout[i]!]!
    const hero = i === 0 && heroSeat !== null && seat === heroSeat
    const toCenter = { x: CENTER.x - pos.x, y: CENTER.y - pos.y }
    const len = Math.hypot(toCenter.x, toCenter.y) || 1
    const nx = toCenter.x / len
    const ny = toCenter.y / len
    const top = pos.y < 200
    // Карты соседа: к центру стола, у верхних мест сбоку, чтобы не закрывать табличку с именем.
    const cards = hero ? { x: 800, y: 680 } : top ? { x: pos.x + 104, y: pos.y + 4 } : { x: pos.x + nx * 116, y: pos.y + ny * 116 - 6 }
    // Ставка: на сукне перед игроком.
    const reach = top ? 172 : 196
    const bet = hero ? { x: 800, y: 572 } : { x: pos.x + nx * reach, y: pos.y + ny * reach }
    // Баттон: чуть сбоку от линии к центру.
    const side = { x: -ny, y: nx }
    const bAnchor = { x: pos.x + nx * 150, y: pos.y + ny * 150 }
    const button = hero ? { x: 930, y: 640 } : { x: bAnchor.x + side.x * 56, y: bAnchor.y + side.y * 56 }
    out.set(seat, { seat, pos, bet, cards, button, hero })
  }
  return out
}

export function boardSlot(i: number): Pt {
  const total = 5 * BOARD_CARD.w + 4 * BOARD_CARD.gap
  const x0 = CENTER.x - total / 2 + BOARD_CARD.w / 2
  return { x: x0 + i * (BOARD_CARD.w + BOARD_CARD.gap), y: BOARD_Y }
}

/** Куда падает тень от лампы для точки на столе: прочь от центра. */
export function shadowFor(p: Pt, strength = 10): { x: number; y: number } {
  const dx = p.x - CENTER.x
  const dy = p.y - CENTER.y
  const d = Math.hypot(dx, dy) || 1
  const k = Math.min(1, d / 600)
  return { x: (dx / d) * strength * k, y: (dy / d) * strength * k + 4 }
}
