import { fullDeck, seededRandomInt, type Card } from './cards.ts'

// Быстрая оценка руки из 5–7 карт: тот же счёт, что у evaluateBest, но без перебора пятёрок.
// Нужна там, где рук много: шансы при олл-ине и для зрителей.

const RANK: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 }
const SUIT: Record<string, number> = { s: 0, h: 1, d: 2, c: 3 }

const counts = new Int8Array(15)
const suitMask = new Int32Array(4)
const suitCount = new Int8Array(4)

function pack(category: number, a = 0, b = 0, c = 0, d = 0, e = 0): number {
  return ((((category * 15 + a) * 15 + b) * 15 + c) * 15 + d) * 15 + e
}

/** Старшая карта стрита в маске рангов (бит r = ранг r), 0 если стрита нет. Туз играет и единицей. */
function straightHigh(mask: number): number {
  const m = mask & (1 << 14) ? mask | 2 : mask
  for (let high = 14; high >= 5; high--) {
    const need = 0b11111 << (high - 4)
    if ((m & need) === need) return high
  }
  return 0
}

/** До n старших рангов из маски, по убыванию. */
function top(mask: number, n: number): number[] {
  const out: number[] = []
  for (let r = 14; r >= 2 && out.length < n; r--) if (mask & (1 << r)) out.push(r)
  return out
}

/** Сила лучшей руки из 5–7 карт. Сравнима с evaluateBest(cards).score и равна ему. */
export function handScore(cards: readonly Card[]): number {
  counts.fill(0)
  suitMask.fill(0)
  suitCount.fill(0)
  let mask = 0
  for (const card of cards) {
    const r = RANK[card[0]!]!
    const s = SUIT[card[1]!]!
    counts[r] = counts[r]! + 1
    suitMask[s] = suitMask[s]! | (1 << r)
    suitCount[s] = suitCount[s]! + 1
    mask |= 1 << r
  }

  let flush = -1
  for (let s = 0; s < 4; s++) if (suitCount[s]! >= 5) flush = s
  if (flush >= 0) {
    const sf = straightHigh(suitMask[flush]!)
    if (sf) return pack(8, sf)
  }

  let quad = 0
  let trips = 0
  let trips2 = 0
  let pair = 0
  let pair2 = 0
  for (let r = 14; r >= 2; r--) {
    const n = counts[r]!
    if (n === 4) quad = r
    else if (n === 3) {
      if (!trips) trips = r
      else if (!trips2) trips2 = r
    } else if (n === 2) {
      if (!pair) pair = r
      else if (!pair2) pair2 = r
    }
  }

  if (quad) return pack(7, quad, top(mask & ~(1 << quad), 1)[0])
  if (trips && (trips2 || pair)) return pack(6, trips, Math.max(trips2, pair))
  if (flush >= 0) {
    const [a, b, c, d, e] = top(suitMask[flush]!, 5)
    return pack(5, a, b, c, d, e)
  }
  const st = straightHigh(mask)
  if (st) return pack(4, st)
  if (trips) {
    const [a, b] = top(mask & ~(1 << trips), 2)
    return pack(3, trips, a, b)
  }
  if (pair && pair2) return pack(2, pair, pair2, top(mask & ~(1 << pair) & ~(1 << pair2), 1)[0])
  if (pair) {
    const [a, b, c] = top(mask & ~(1 << pair), 3)
    return pack(1, pair, a, b, c)
  }
  const [a, b, c, d, e] = top(mask, 5)
  return pack(0, a, b, c, d, e)
}

/** Категория руки по счёту: 0 старшая карта … 8 стрит-флеш. */
export function scoreCategory(score: number): number {
  return Math.floor(score / 15 ** 5)
}

function hashCards(cards: readonly Card[]): number {
  let h = 0x811c9dc5
  for (const c of [...cards].sort()) {
    for (let i = 0; i < c.length; i++) {
      h ^= c.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
  }
  return h >>> 0
}

/** Сколько случайных досдач на префлопе: погрешность около процента. */
export const EQUITY_SAMPLES = 6000

/**
 * Шансы каждой руки забрать банк при известных картах: доля выигрыша с учётом делёжки.
 * Когда до конца доски не больше двух карт, перебираются все варианты; иначе случайная выборка
 * с зерном от самих карт, так что у всех за столом получаются одинаковые числа.
 */
export function equity(holes: readonly Card[][], board: readonly Card[], samples = EQUITY_SAMPLES): number[] {
  const n = holes.length
  const share = new Array<number>(n).fill(0)
  if (n === 0) return share
  const known = new Set<Card>([...board, ...holes.flat()])
  const rest = fullDeck().filter((c) => !known.has(c))
  const need = 5 - board.length
  const scores = new Array<number>(n)
  const run = holes.map((h) => [...h, ...board] as Card[])
  let total = 0

  const settle = (extra: readonly Card[]) => {
    let best = -1
    let winners = 0
    for (let i = 0; i < n; i++) {
      const s = handScore(extra.length ? [...run[i]!, ...extra] : run[i]!)
      scores[i] = s
      if (s > best) {
        best = s
        winners = 1
      } else if (s === best) winners++
    }
    for (let i = 0; i < n; i++) if (scores[i] === best) share[i]! += 1 / winners
    total++
  }

  if (need <= 0) settle([])
  else if (need === 1) for (const a of rest) settle([a])
  else if (need === 2) {
    for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) settle([rest[i]!, rest[j]!])
  } else {
    const rand = seededRandomInt(hashCards([...known]))
    const deck = [...rest]
    const extra: Card[] = new Array(need)
    for (let k = 0; k < samples; k++) {
      // Частичная перетасовка: первые need карт колоды становятся досдачей.
      for (let i = 0; i < need; i++) {
        const j = i + rand(deck.length - i)
        const t = deck[i]!
        deck[i] = deck[j]!
        deck[j] = t
        extra[i] = deck[i]!
      }
      settle(extra)
    }
  }
  return share.map((s) => s / total)
}
