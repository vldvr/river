// Elo для партии из нескольких игроков: каждый сравнивается с каждым.
// Считает только сервер, клиенты рейтинг не присылают.

export const START_RATING = 1000
export const MIN_RATING = 100
export const MAX_RATING = 3000

/**
 * @param {{id: string, rating: number, games: number, rank: number, score?: number}[]} players
 *   rank: чем меньше, тем лучше, равные допустимы; score: доля результата 0..1 для множителя разрыва.
 * @returns {{id: string, rating: number, delta: number, games: number}[]}
 */
export function updateRatings(players) {
  if (players.length < 2) return players.map((p) => ({ id: p.id, rating: p.rating, delta: 0, games: p.games }))
  const raw = players.map((player) => {
    let delta = 0
    for (const opponent of players) {
      if (opponent.id === player.id) continue
      const expected = 1 / (1 + 10 ** ((opponent.rating - player.rating) / 400))
      const actual = player.rank < opponent.rank ? 1 : player.rank > opponent.rank ? 0 : 0.5
      const margin = 1 + 0.25 * Math.min(1, Math.abs((player.score ?? 0) - (opponent.score ?? 0)))
      const k = player.games < 10 || opponent.games < 10 ? 32 : 20
      delta += (k * margin * (actual - expected)) / (players.length - 1)
    }
    return { player, rounded: Math.round(delta) }
  })
  // Округление не должно рождать или сжигать очки: сумма изменений равна нулю.
  let correction = -raw.reduce((sum, item) => sum + item.rounded, 0)
  const order = [...raw].sort((a, b) => Math.abs(b.rounded) - Math.abs(a.rounded))
  while (correction !== 0) {
    let changed = false
    for (const item of order) {
      if (correction === 0) break
      const step = correction > 0 ? 1 : -1
      const next = item.player.rating + item.rounded + step
      if (next >= MIN_RATING && next <= MAX_RATING) {
        item.rounded += step
        correction -= step
        changed = true
      }
    }
    if (!changed) break
  }
  return raw.map(({ player, rounded }) => {
    const rating = Math.max(MIN_RATING, Math.min(MAX_RATING, player.rating + rounded))
    return { id: player.id, rating, delta: rating - player.rating, games: player.games + 1 }
  })
}

/**
 * Места из итога партии. Известное место (турнир) главнее; у кого места нет,
 * тех ранжируем по выигрышу, и они стоят выше всех вылетевших.
 * @param {{id: string, rating: number, games: number, place: number | null, net: number}[]} standings
 */
export function rankStandings(standings) {
  const open = standings.filter((s) => s.place === null).sort((a, b) => b.net - a.net)
  const rank = new Map()
  open.forEach((s, i) => rank.set(s.id, i > 0 && s.net === open[i - 1].net ? rank.get(open[i - 1].id) : i + 1))
  const nets = standings.map((s) => s.net)
  const min = Math.min(...nets)
  const range = Math.max(...nets) - min
  return standings.map((s) => ({
    id: s.id,
    rating: s.rating,
    games: s.games,
    rank: s.place ?? rank.get(s.id),
    score: range === 0 ? 0.5 : (s.net - min) / range,
  }))
}
