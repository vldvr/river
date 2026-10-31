export interface RatingPlayer {
  id: string
  rating: number
  games: number
  /** Lower is better. Equal ranks are allowed. */
  rank: number
  /** Optional normalized performance margin in the [0, 1] range. */
  score?: number
}

export interface RatingChange {
  id: string
  rating: number
  delta: number
  games: number
}

const START_RATING = 1000
const MIN_RATING = 100
const MAX_RATING = 3000

/** Multi-player Elo: every player is compared with every other player. */
export function updateRatings(players: RatingPlayer[]): RatingChange[] {
  if (players.length < 2) {
    return players.map((p) => {
      const performance = p.score ?? 0.5
      const expected = 1 / (1 + 10 ** ((1000 - p.rating) / 400))
      const actual = performance > 0.5 ? 1 : performance < 0.5 ? 0 : 0.5
      const margin = 1 + 0.25 * Math.min(1, Math.abs(performance - 0.5) * 2)
      const k = p.games < 10 ? 32 : 20
      const rating = Math.max(MIN_RATING, Math.min(MAX_RATING, p.rating + Math.round(k * margin * (actual - expected))))
      return { id: p.id, rating, delta: rating - p.rating, games: p.games + 1 }
    })
  }

  const raw = players.map((player) => {
    let delta = 0
    for (const opponent of players) {
      if (opponent.id === player.id) continue
      const expected = 1 / (1 + 10 ** ((opponent.rating - player.rating) / 400))
      const actual = player.rank < opponent.rank ? 1 : player.rank > opponent.rank ? 0 : 0.5
      const margin = 1 + 0.25 * Math.min(1, Math.abs((player.score ?? 0) - (opponent.score ?? 0)))
      const k = player.games < 10 || opponent.games < 10 ? 32 : 20
      delta += k * margin * (actual - expected) / (players.length - 1)
    }
    return { player, rounded: Math.round(delta) }
  })
  let correction = -raw.reduce((sum, item) => sum + item.rounded, 0)
  const order = [...raw].sort((a, b) => Math.abs(b.rounded) - Math.abs(a.rounded))
  while (correction !== 0) {
    let changed = false
    for (const item of order) {
      if (correction === 0) break
      const step = correction > 0 ? 1 : -1
      const next = item.rounded + step
      if (item.player.rating + next >= MIN_RATING && item.player.rating + next <= MAX_RATING) {
        item.rounded = next
        correction -= step
        changed = true
      }
    }
    if (!changed) break
  }

  return raw.map(({ player, rounded }) => {
    const rating = Math.max(MIN_RATING, Math.min(MAX_RATING, player.rating + rounded))
    return {
      id: player.id,
      rating,
      delta: rating - player.rating,
      games: player.games + 1,
    }
  })
}

export function initialRating(): Pick<RatingPlayer, 'rating' | 'games'> {
  return { rating: START_RATING, games: 0 }
}
