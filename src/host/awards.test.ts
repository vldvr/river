import { describe, expect, it } from 'vitest'
import type { ViewEvent } from '../protocol/index.ts'
import { computeAwards, newStats, trackStats, trackThink } from './awards.ts'

const people = [
  { id: 'a', name: 'Аня', color: '#111111', isBot: false },
  { id: 'b', name: 'Боря', color: '#222222', isBot: false },
  { id: 'c', name: 'Кекс', color: '#333333', isBot: true },
]

function start(handNo: number, bb = 20): ViewEvent {
  return {
    t: 'start',
    handNo,
    button: 0,
    sbSeat: 1,
    bbSeat: 2,
    blinds: { sb: bb / 2, bb, ante: 0 },
    seats: people.map((p, seat) => ({ seat, id: p.id, stack: 1000 })),
  }
}

const end: ViewEvent = { t: 'end', stacks: [] }

describe('awards', () => {
  it('bad beat and suckout come from the all-in odds, the big pot from the award', () => {
    const s = newStats()
    trackStats(s, [
      start(1),
      { t: 'act', seat: 0, kind: 'raise', added: 1000, bet: 1000, allIn: true },
      { t: 'act', seat: 1, kind: 'call', added: 1000, bet: 1000, allIn: true },
      { t: 'act', seat: 2, kind: 'fold', added: 0, bet: 20, allIn: false },
      // AA против 72: у Ани около 88%.
      {
        t: 'reveal',
        hands: [
          { seat: 0, cards: ['As', 'Ad'] },
          { seat: 1, cards: ['7c', '2h'] },
        ],
      },
      { t: 'board', street: 'flop', cards: ['7d', '7h', 'Kc'] },
      { t: 'board', street: 'turn', cards: ['3s'] },
      { t: 'board', street: 'river', cards: ['9d'] },
      {
        t: 'showdown',
        hands: [
          { seat: 0, name: 'Две пары, тузы и семёрки', best: ['As', 'Ad', '7d', '7h', 'Kc'] },
          { seat: 1, name: 'Фулл-хаус, семёрки на двойках', best: ['7c', '7d', '7h', '2h', '2h'] },
        ],
      },
      { t: 'award', pot: 0, amount: 2020, winners: [{ seat: 1, amount: 2020 }], hand: null },
      end,
    ])
    const awards = computeAwards(s, people)
    const bad = awards.find((a) => a.kind === 'badBeat')!
    const luck = awards.find((a) => a.kind === 'suckout')!
    expect(bad.id).toBe('a')
    expect(bad.value).toBeGreaterThan(0.8)
    expect(luck.id).toBe('b')
    expect(luck.value).toBeLessThan(0.2)
    expect(awards.find((a) => a.kind === 'bigPot')).toMatchObject({ id: 'b', value: 2020, bb: 101, handNo: 1 })
    expect(awards.find((a) => a.kind === 'bestHand')?.id).toBe('b')
  })

  it('needs enough hands for style awards and never names a bot the thinker', () => {
    const s = newStats()
    for (let n = 1; n <= 12; n++) {
      trackStats(s, [
        start(n),
        // Аня заходит в каждую раздачу рейзом, Боря всегда сбрасывает, бот коллирует.
        { t: 'act', seat: 0, kind: 'raise', added: 60, bet: 60, allIn: false },
        { t: 'act', seat: 1, kind: 'fold', added: 0, bet: 10, allIn: false },
        { t: 'act', seat: 2, kind: 'call', added: 40, bet: 60, allIn: false },
        { t: 'award', pot: 0, amount: 130, winners: [{ seat: 0, amount: 130 }], hand: null },
        end,
      ])
      trackThink(s, 'a', 1000)
      trackThink(s, 'b', 9000)
      trackThink(s, 'c', 20000)
    }
    const kinds = Object.fromEntries(computeAwards(s, people).map((a) => [a.kind, a]))
    expect(kinds.aggro?.id).toBe('a')
    expect(kinds.aggro?.value).toBe(12)
    expect(kinds.loose?.id).toBe('a')
    expect(kinds.tight?.id).toBe('b')
    expect(kinds.tight?.value).toBe(0)
    expect(kinds.thinker?.id).toBe('b')
    // Маленькие банки номинации не получают.
    expect(kinds.bigPot).toBeUndefined()
  })

  it('a short game with nothing special gives no awards', () => {
    const s = newStats()
    trackStats(s, [start(1), { t: 'act', seat: 0, kind: 'fold', added: 0, bet: 0, allIn: false }, end])
    expect(computeAwards(s, people)).toEqual([])
  })
})
