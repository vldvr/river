import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { evaluateBest, evaluate5, Category } from './evaluator.ts'
import { handName, partialHandName } from './names.ts'
import { seededRandomInt, shuffledDeck } from './cards.ts'

const require = createRequire(import.meta.url)
const { Hand } = require('pokersolver') as {
  Hand: { solve(cards: string[]): unknown; winners(hands: unknown[]): unknown[] }
}

describe('evaluator', () => {
  it('ranks categories', () => {
    expect(evaluate5(['As', 'Ks', 'Qs', 'Js', 'Ts']).category).toBe(Category.StraightFlush)
    expect(evaluate5(['5d', '4d', '3d', '2d', 'Ad']).ranks[0]).toBe(5)
    expect(evaluate5(['9c', '9d', '9h', '9s', '2d']).category).toBe(Category.Quads)
    expect(evaluate5(['9c', '9d', '9h', '2s', '2d']).category).toBe(Category.FullHouse)
    expect(evaluate5(['Ac', '5d', '4h', '3s', '2d']).category).toBe(Category.Straight)
    expect(evaluate5(['Ac', 'Kd', 'Qh', 'Js', '9d']).category).toBe(Category.HighCard)
  })

  it('wheel loses to six-high straight', () => {
    const wheel = evaluate5(['Ac', '5d', '4h', '3s', '2d'])
    const six = evaluate5(['6c', '5d', '4h', '3s', '2d'])
    expect(six.score).toBeGreaterThan(wheel.score)
    expect(wheel.cards.map((c) => c[0])).toEqual(['5', '4', '3', '2', 'A'])
  })

  it('names hands in Russian', () => {
    expect(handName(evaluateBest(['Qs', 'Qd', '7h', '4c', '2s', '9d', '3h']))).toBe('Пара дам')
    expect(handName(evaluateBest(['Js', 'Jd', '5h', '5c', '2s', '9d', '3h']))).toBe('Две пары: валеты и пятёрки')
    expect(handName(evaluateBest(['As', 'Ks', 'Qs', 'Js', 'Ts', '9d', '3h']))).toBe('Роял-флеш')
    expect(handName(evaluateBest(['7s', '7d', '7h', 'Kc', '2s', '9d', '3h']))).toBe('Три семёрки')
    expect(handName(evaluateBest(['As', '2d', '3h', '4c', '5s', '9d', 'Kh']))).toBe('Стрит до пятёрки')
    expect(partialHandName(['Ks', 'Kd'])).toBe('Пара королей')
    expect(partialHandName(['Ks', 'Qd', '4c'])).toBe('Старшая карта: король')
  })

  it('agrees with pokersolver on random showdowns', () => {
    const rand = seededRandomInt(12345)
    for (let i = 0; i < 20_000; i++) {
      const deck = shuffledDeck(rand)
      const board = deck.slice(0, 5)
      const a = [...board, deck[5]!, deck[6]!]
      const b = [...board, deck[7]!, deck[8]!]
      const ours = Math.sign(evaluateBest(a).score - evaluateBest(b).score)
      const ha = Hand.solve(a)
      const hb = Hand.solve(b)
      const w = Hand.winners([ha, hb])
      const theirs = w.length === 2 ? 0 : w[0] === ha ? 1 : -1
      if (ours !== theirs) throw new Error(`mismatch on ${a.join(' ')} vs ${b.join(' ')}`)
    }
  })
})
