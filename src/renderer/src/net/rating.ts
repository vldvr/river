import type { RatingService } from '../../../host/index.ts'
import { useApp } from '../store/app'
import { RELAY_URL } from './relay'

/** Рейтинг живёт на том же сервере, что и комнаты. */
const API = RELAY_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/api')

export class NoAccountError extends Error {}

async function post<T>(route: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (res.status === 404) throw new NoAccountError()
  if (!res.ok) throw new Error(`rating ${route}: ${res.status}`)
  return (await res.json()) as T
}

type Me = { id: string; rating: number; games: number }

/** Старый рейтинг из профиля уходит на сервер один раз, при первом входе. */
function legacy() {
  const p = useApp.getState().profile
  return p.migrated ? undefined : { rating: p.rating, games: p.ratingGames }
}

function remember(me: Me) {
  useApp.getState().setProfile({ rating: me.rating, ratingGames: me.games, migrated: true })
}

/** Свежий рейтинг с сервера. Без сети остаётся последний известный. */
export async function refreshRating(): Promise<void> {
  try {
    remember(await post<Me>('me', { secret: useApp.getState().profile.secret, legacy: legacy() }))
  } catch {
    // нет сети: покажем последний известный
  }
}

/** Вход по коду восстановления: только в существующий аккаунт. */
export async function restoreAccount(secret: string): Promise<Me> {
  const me = await post<Me>('me', { secret, existing: true })
  useApp.getState().setProfile({ secret, rating: me.rating, ratingGames: me.games, migrated: true })
  return me
}

const tickets = new Map<string, { ticket: string; at: number }>()

/** Билет для комнаты: хост по нему узнаёт аккаунт, кода восстановления он не видит. */
export async function ticketFor(code: string): Promise<string> {
  const secret = useApp.getState().profile.secret
  const key = `${secret}:${code}`
  const cached = tickets.get(key)
  if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.ticket
  const r = await post<Me & { ticket: string }>('ticket', { secret, code, legacy: legacy() })
  remember(r)
  tickets.set(key, { ticket: r.ticket, at: Date.now() })
  return r.ticket
}

/** Сервис для хоста: проверка гостей и отчёты о партии. */
export function hostRatings(code: string, relaySecret: string): RatingService {
  return {
    async seat(ticket) {
      try {
        const r = await post<Me>('seat', { ticket, code })
        return { account: r.id, rating: r.rating, games: r.games }
      } catch {
        return null
      }
    },
    async report(r) {
      try {
        return await post('game', { ...r, code, secret: relaySecret })
      } catch {
        return null
      }
    },
  }
}
