import type { CardBack } from '../../../protocol/index.ts'

/** Что открывается за партии в зачёт и рейтинг. Проверка на клиенте: это украшения, не преимущество. */
export interface Unlock {
  games?: number
  rating?: number
}

export const BACKS: { id: CardBack; name: string; unlock: Unlock }[] = [
  { id: 'classic', name: 'Сетка', unlock: {} },
  { id: 'lamp', name: 'Лампа', unlock: {} },
  { id: 'wave', name: 'Волны', unlock: { games: 3 } },
  { id: 'ivy', name: 'Плющ', unlock: { games: 10 } },
  { id: 'checker', name: 'Шашки', unlock: { games: 25 } },
  { id: 'night', name: 'Ночь', unlock: { games: 50 } },
  { id: 'gold', name: 'Золото', unlock: { rating: 1150 } },
]

export function isOpen(u: Unlock, rating: number, games: number): boolean {
  return (u.games === undefined || games >= u.games) && (u.rating === undefined || rating >= u.rating)
}

/** Полная подсказка для title и чтения с экрана. */
export function unlockHint(u: Unlock): string {
  if (u.rating !== undefined) return `Откроется, когда Эло дойдёт до ${u.rating}`
  if (u.games !== undefined) return `Откроется после ${u.games} ${u.games % 10 === 1 && u.games % 100 !== 11 ? 'партии' : 'партий'} в зачёт`
  return ''
}

/** Короткая строка под закрытой плиткой: сколько осталось. */
export function unlockLeft(u: Unlock, rating: number, games: number): string {
  if (u.rating !== undefined && rating < u.rating) return `Нужно Эло ${u.rating}`
  if (u.games !== undefined && games < u.games) {
    const left = u.games - games
    return `Ещё ${left} ${gamesWord(left)}`
  }
  return ''
}

/** Что считается партией в зачёт: одна строка под выбором. */
export const UNLOCK_RULE = 'Партия идёт в зачёт, если это покер с людьми, без ботов, от 15 раздач.'

function gamesWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'партия'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'партии'
  return 'партий'
}
