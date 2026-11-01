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

export function unlockHint(u: Unlock): string {
  if (u.rating !== undefined) return `Откроется на Эло ${u.rating}`
  if (u.games !== undefined) return `Откроется после ${u.games} ${plural(u.games)} в зачёт`
  return ''
}

function plural(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'партии'
  return 'партий'
}
