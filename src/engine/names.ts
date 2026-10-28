import { Category, type HandValue } from './evaluator.ts'
import { rankOf, type Card } from './cards.ts'

// Индекс = ранг (2..14).
const NOM: Record<number, string> = {
  2: 'двойка', 3: 'тройка', 4: 'четвёрка', 5: 'пятёрка', 6: 'шестёрка', 7: 'семёрка',
  8: 'восьмёрка', 9: 'девятка', 10: 'десятка', 11: 'валет', 12: 'дама', 13: 'король', 14: 'туз',
}
const GEN: Record<number, string> = {
  2: 'двойки', 3: 'тройки', 4: 'четвёрки', 5: 'пятёрки', 6: 'шестёрки', 7: 'семёрки',
  8: 'восьмёрки', 9: 'девятки', 10: 'десятки', 11: 'валета', 12: 'дамы', 13: 'короля', 14: 'туза',
}
const NOM_PL: Record<number, string> = {
  2: 'двойки', 3: 'тройки', 4: 'четвёрки', 5: 'пятёрки', 6: 'шестёрки', 7: 'семёрки',
  8: 'восьмёрки', 9: 'девятки', 10: 'десятки', 11: 'валеты', 12: 'дамы', 13: 'короли', 14: 'тузы',
}
const GEN_PL: Record<number, string> = {
  2: 'двоек', 3: 'троек', 4: 'четвёрок', 5: 'пятёрок', 6: 'шестёрок', 7: 'семёрок',
  8: 'восьмёрок', 9: 'девяток', 10: 'десяток', 11: 'валетов', 12: 'дам', 13: 'королей', 14: 'тузов',
}

export const CATEGORY_NAMES: Record<Category, string> = {
  [Category.HighCard]: 'Старшая карта',
  [Category.Pair]: 'Пара',
  [Category.TwoPair]: 'Две пары',
  [Category.Trips]: 'Тройка',
  [Category.Straight]: 'Стрит',
  [Category.Flush]: 'Флеш',
  [Category.FullHouse]: 'Фулл-хаус',
  [Category.Quads]: 'Каре',
  [Category.StraightFlush]: 'Стрит-флеш',
}

/** Полное название руки по-русски: «Пара дам», «Две пары: валеты и пятёрки». */
export function handName(v: Pick<HandValue, 'category' | 'ranks'>): string {
  const [a = 0, b = 0] = v.ranks
  switch (v.category) {
    case Category.HighCard:
      return `Старшая карта: ${NOM[a]}`
    case Category.Pair:
      return `Пара ${GEN_PL[a]}`
    case Category.TwoPair:
      return `Две пары: ${NOM_PL[a]} и ${NOM_PL[b]}`
    case Category.Trips:
      return `Три ${GEN[a]}`
    case Category.Straight:
      return `Стрит до ${GEN[a]}`
    case Category.Flush:
      return `Флеш до ${GEN[a]}`
    case Category.FullHouse:
      return `Фулл-хаус: ${NOM_PL[a]} и ${NOM_PL[b]}`
    case Category.Quads:
      return `Каре ${GEN_PL[a]}`
    case Category.StraightFlush:
      return a === 14 ? 'Роял-флеш' : `Стрит-флеш до ${GEN[a]}`
  }
}

/** Короткая подсказка силы руки до ривера: по 2–4 картам тоже. */
export function partialHandName(cards: Card[]): string {
  const rs = cards.map(rankOf).sort((x, y) => y - x)
  const counts = new Map<number, number>()
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])
  const [g0, g1] = groups
  if (g0 && g0[1] === 4) return `Каре ${GEN_PL[g0[0]]}`
  if (g0 && g0[1] === 3) return `Три ${GEN[g0[0]]}`
  if (g0 && g1 && g0[1] === 2 && g1[1] === 2) return `Две пары: ${NOM_PL[g0[0]]} и ${NOM_PL[g1[0]]}`
  if (g0 && g0[1] === 2) return `Пара ${GEN_PL[g0[0]]}`
  return `Старшая карта: ${NOM[rs[0] ?? 2]}`
}

export function rankName(rank: number): string {
  return NOM[rank] ?? ''
}
