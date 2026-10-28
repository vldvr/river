export const RANK_CHARS = '23456789TJQKA'
export const SUITS = ['s', 'h', 'd', 'c'] as const

export type Suit = (typeof SUITS)[number]
/** Карта в виде строки: ранг и масть, например "As", "Td", "7c". */
export type Card = string

export function rankOf(card: Card): number {
  return RANK_CHARS.indexOf(card[0]!) + 2
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit
}

export function isCard(value: unknown): value is Card {
  return (
    typeof value === 'string' &&
    value.length === 2 &&
    RANK_CHARS.includes(value[0]!) &&
    (SUITS as readonly string[]).includes(value[1]!)
  )
}

export function fullDeck(): Card[] {
  const deck: Card[] = []
  for (const s of SUITS) for (const r of RANK_CHARS) deck.push(r + s)
  return deck
}

/** Целое в [0, n), равномерно. */
export type RandomInt = (n: number) => number

/** Криптостойкий генератор с отбраковкой, чтобы не было смещения по модулю. */
export const cryptoRandomInt: RandomInt = (n) => {
  if (n <= 0 || n > 2 ** 32) throw new RangeError(`bad range ${n}`)
  const limit = Math.floor(2 ** 32 / n) * n
  const buf = new Uint32Array(1)
  for (;;) {
    globalThis.crypto.getRandomValues(buf)
    if (buf[0]! < limit) return buf[0]! % n
  }
}

/** Детерминированный генератор для тестов и симуляций (mulberry32). */
export function seededRandomInt(seed: number): RandomInt {
  let a = seed >>> 0
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const x = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    return Math.floor(x * n)
  }
}

export function shuffledDeck(rand: RandomInt = cryptoRandomInt): Card[] {
  const deck = fullDeck()
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    const tmp = deck[i]!
    deck[i] = deck[j]!
    deck[j] = tmp
  }
  return deck
}
