export interface Contribution {
  seat: number
  amount: number
  folded: boolean
}

export interface Pot {
  amount: number
  /** Места, которые могут выиграть этот банк. */
  eligible: number[]
}

/**
 * Делит вложенные за раздачу фишки на основной и побочные банки.
 * Несыгранная ставка уже должна быть возвращена.
 */
export function buildPots(contributions: Contribution[]): Pot[] {
  const left = new Map(contributions.map((c) => [c.seat, c.amount]))
  const folded = new Set(contributions.filter((c) => c.folded).map((c) => c.seat))
  const pots: Pot[] = []

  for (;;) {
    const live = [...left.entries()].filter(([seat, amt]) => amt > 0 && !folded.has(seat))
    if (live.length === 0) break
    const level = Math.min(...live.map(([, amt]) => amt))
    let amount = 0
    for (const [seat, amt] of left) {
      const take = Math.min(amt, level)
      amount += take
      left.set(seat, amt - take)
    }
    const eligible = live.map(([seat]) => seat).sort((a, b) => a - b)
    const prev = pots[pots.length - 1]
    if (prev && sameSeats(prev.eligible, eligible)) prev.amount += amount
    else pots.push({ amount, eligible })
  }

  // Мёртвые фишки сфолдивших сверх последнего уровня (на практике не бывает) уходят в последний банк.
  const rest = [...left.values()].reduce((s, v) => s + v, 0)
  if (rest > 0 && pots.length > 0) pots[pots.length - 1]!.amount += rest

  return pots
}

function sameSeats(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** Делит сумму поровну; лишние фишки по одной получают первые в `order`. */
export function splitAmount(amount: number, order: number[]): Map<number, number> {
  const share = Math.floor(amount / order.length)
  let odd = amount - share * order.length
  const result = new Map<number, number>()
  for (const seat of order) {
    result.set(seat, share + (odd > 0 ? 1 : 0))
    if (odd > 0) odd--
  }
  return result
}
