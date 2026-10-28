import { rankOf, suitOf, type Card } from './cards.ts'

export const Category = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const
export type Category = (typeof Category)[keyof typeof Category]

export interface HandValue {
  /** Чем больше, тем сильнее. Сравнимо между любыми руками. */
  score: number
  category: Category
  /** Ранги в порядке значимости: группы, потом кикеры (для стрита только старшая). */
  ranks: number[]
  /** Лучшая пятёрка в порядке показа. */
  cards: Card[]
}

function scoreOf(category: Category, ranks: number[]): number {
  let score = category
  for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] ?? 0)
  return score
}

export function evaluate5(cards: Card[]): HandValue {
  if (cards.length !== 5) throw new Error('evaluate5 needs 5 cards')
  const rs = cards.map(rankOf).sort((a, b) => b - a)
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!))

  const counts = new Map<number, number>()
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])

  let straightHigh = 0
  if (groups.length === 5) {
    if (rs[0]! - rs[4]! === 4) straightHigh = rs[0]!
    else if (rs[0] === 14 && rs[1] === 5) straightHigh = 5
  }

  let category: Category
  let ranks: number[]
  const g = groups.map((x) => x[0])
  if (straightHigh && flush) {
    category = Category.StraightFlush
    ranks = [straightHigh]
  } else if (groups[0]![1] === 4) {
    category = Category.Quads
    ranks = g
  } else if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    category = Category.FullHouse
    ranks = g
  } else if (flush) {
    category = Category.Flush
    ranks = rs
  } else if (straightHigh) {
    category = Category.Straight
    ranks = [straightHigh]
  } else if (groups[0]![1] === 3) {
    category = Category.Trips
    ranks = g
  } else if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    category = Category.TwoPair
    ranks = g
  } else if (groups[0]![1] === 2) {
    category = Category.Pair
    ranks = g
  } else {
    category = Category.HighCard
    ranks = rs
  }

  return { score: scoreOf(category, ranks), category, ranks, cards: orderForDisplay(cards, category, ranks) }
}

function orderForDisplay(cards: Card[], category: Category, ranks: number[]): Card[] {
  if (category === Category.Straight || category === Category.StraightFlush) {
    const high = ranks[0]!
    const wanted = high === 5 ? [5, 4, 3, 2, 14] : [high, high - 1, high - 2, high - 3, high - 4]
    return wanted.map((r) => cards.find((c) => rankOf(c) === r)!)
  }
  const order = (c: Card) => ranks.indexOf(rankOf(c))
  return [...cards].sort((a, b) => order(a) - order(b) || a[1]!.localeCompare(b[1]!))
}

/** Лучшая рука из 5–7 карт. */
export function evaluateBest(cards: Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error('need 5..7 cards')
  if (cards.length === 5) return evaluate5(cards)
  let best: HandValue | null = null
  const n = cards.length
  const pick: Card[] = new Array(5)
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            pick[0] = cards[a]!
            pick[1] = cards[b]!
            pick[2] = cards[c]!
            pick[3] = cards[d]!
            pick[4] = cards[e]!
            const v = evaluate5(pick)
            if (!best || v.score > best.score) best = v
          }
  return best!
}
