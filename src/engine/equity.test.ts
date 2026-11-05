import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { fullDeck, seededRandomInt, shuffledDeck, type Card } from './cards.ts'
import { equity, handScore, scoreCategory } from './equity.ts'
import { evaluateBest } from './evaluator.ts'
import { act, rabbitCards, startHand } from './hand.ts'

describe('handScore', () => {
  it('matches evaluateBest on random 5, 6 and 7 card hands', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 5, max: 7 }), (seed, size) => {
        const cards = shuffledDeck(seededRandomInt(seed)).slice(0, size)
        expect(handScore(cards)).toBe(evaluateBest(cards).score)
      }),
      { numRuns: 4000 },
    )
  })

  it('matches on tricky shapes: wheel, two trips, three pairs, quads with a pair', () => {
    const hands: Card[][] = [
      ['As', '2d', '3c', '4h', '5s', 'Kd', 'Kc'],
      ['9s', '9d', '9c', '4h', '4s', '4d', 'Ac'],
      ['Ts', 'Td', '7c', '7h', '3s', '3d', 'Ac'],
      ['Qs', 'Qd', 'Qc', 'Qh', 'Js', 'Jd', '2c'],
      ['2h', '3h', '4h', '5h', 'Ah', 'Kh', '6c'],
      ['Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h', '8h'],
    ]
    for (const h of hands) expect(handScore(h)).toBe(evaluateBest(h).score)
  })

  it('knows the category', () => {
    expect(scoreCategory(handScore(['Ah', 'Kh', 'Qh', 'Jh', 'Th']))).toBe(8)
    expect(scoreCategory(handScore(['2c', '7d', '9h', 'Js', 'Kd']))).toBe(0)
  })
})

describe('equity', () => {
  it('a made hand on the turn: exact count over the river', () => {
    // Сет против флеш-дро. Червей в колоде 9, но 8♥ даёт сету каре, а Q♥ фулл: у дро 7 аутов из 44.
    const [set, draw] = equity(
      [
        ['8s', '8d'],
        ['Ah', 'Kh'],
      ],
      ['8c', '2h', '7h', 'Qs'],
    )
    expect(set! + draw!).toBeCloseTo(1, 10)
    expect(draw!).toBeCloseTo(7 / 44, 10)
  })

  it('a dead hand is 0 and the nut hand is 1', () => {
    const [a, b] = equity(
      [
        ['As', 'Ks'],
        ['2d', '3c'],
      ],
      ['Qs', 'Js', 'Ts', '4h'],
    )
    expect(a).toBe(1)
    expect(b).toBe(0)
  })

  it('splits are shared', () => {
    const [a, b] = equity(
      [
        ['2c', '3d'],
        ['2h', '3s'],
      ],
      ['Ah', 'Kd', 'Qc', 'Js', 'Th'],
    )
    expect(a).toBe(0.5)
    expect(b).toBe(0.5)
  })

  it('preflop is close to the known numbers and the same every time', () => {
    const holes: Card[][] = [
      ['As', 'Ad'],
      ['Kc', 'Kh'],
    ]
    const first = equity(holes, [])
    expect(first[0]!).toBeGreaterThan(0.79)
    expect(first[0]!).toBeLessThan(0.84)
    expect(equity(holes, [])).toEqual(first)
    // Порядок рук не меняет чисел: зерно берётся от набора карт.
    expect(equity([holes[1]!, holes[0]!], [])[1]).toBeCloseTo(first[0]!, 10)
  })

  it('three ways adds up to one', () => {
    const e = equity(
      [
        ['As', 'Kd'],
        ['7c', '7h'],
        ['Qs', 'Jd'],
      ],
      ['2c', '9d', 'Th'],
    )
    expect(e.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10)
  })

  it('never deals a known card', () => {
    const used = new Set(['As', 'Ad', 'Kc', 'Kh'])
    expect(fullDeck().filter((c) => !used.has(c))).toHaveLength(48)
    // Если бы туз из руки попал в досдачу, у AA бывало бы каре чаще, чем возможно.
    const [aa] = equity(
      [
        ['As', 'Ad'],
        ['Ac', 'Ah'],
      ],
      ['2c', '7d', '9h'],
    )
    expect(aa).toBe(0.5)
  })
})

describe('rabbitCards', () => {
  const deck = shuffledDeck(seededRandomInt(11))

  it('shows the rest of the board after a preflop fold, with burns', () => {
    const { hand: h } = startHand({
      handNo: 1,
      seats: [
        { id: 'a', seat: 0, stack: 1000 },
        { id: 'b', seat: 1, stack: 1000 },
      ],
      button: 0,
      blinds: { sb: 10, bb: 20, ante: 0 },
      deck,
    })
    expect(rabbitCards(h)).toEqual([])
    act(h, 0, { type: 'fold' })
    // 4 карты в руки, дальше: сжечь, флоп, сжечь, тёрн, сжечь, ривер.
    expect(rabbitCards(h)).toEqual([deck[5], deck[6], deck[7], deck[9], deck[11]])
    expect(h.deck).toHaveLength(48)
  })

  it('completes a board that stopped on the flop', () => {
    const { hand: h } = startHand({
      handNo: 1,
      seats: [
        { id: 'a', seat: 0, stack: 1000 },
        { id: 'b', seat: 1, stack: 1000 },
      ],
      button: 0,
      blinds: { sb: 10, bb: 20, ante: 0 },
      deck,
    })
    act(h, 0, { type: 'call' })
    act(h, 1, { type: 'check' })
    expect(h.board).toEqual([deck[5], deck[6], deck[7]])
    act(h, 1, { type: 'raise', to: 40 })
    act(h, 0, { type: 'fold' })
    expect(rabbitCards(h)).toEqual([deck[9], deck[11]])
  })
})
