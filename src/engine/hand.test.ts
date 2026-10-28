import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { fullDeck, seededRandomInt, shuffledDeck, type Card } from './cards.ts'
import { act, legalActions, startHand, type HandEvent, type HandState } from './hand.ts'
import { applyAction, addPlayer, canStartHand, chipsInPlay, createGame, legalFor, rebuy, startNextHand, DEFAULT_CONFIG } from './game.ts'

/** Колода, в которой нужные карты лягут нужным местам. */
function rigged(seats: number[], button: number, holes: Record<number, [Card, Card]>, board: Card[]): Card[] {
  const sorted = [...seats].sort((a, b) => a - b)
  const b = sorted.indexOf(button)
  const order = sorted.map((_, i) => sorted[(b + 1 + i) % sorted.length]!)
  const used = new Set<Card>([...Object.values(holes).flat(), ...board])
  const filler = fullDeck().filter((c) => !used.has(c))
  const take = () => filler.shift()!
  const deck: Card[] = []
  for (let pass = 0; pass < 2; pass++) for (const s of order) deck.push(holes[s]?.[pass] ?? take())
  const bd = [...board]
  const next = () => bd.shift() ?? take()
  deck.push(take(), next(), next(), next(), take(), next(), take(), next())
  return [...deck, ...filler]
}

function setup(stacks: number[], opts: { button?: number; sb?: number; bb?: number; ante?: number; deck?: Card[] } = {}) {
  return startHand({
    handNo: 1,
    seats: stacks.map((stack, seat) => ({ id: `p${seat}`, seat, stack })),
    button: opts.button ?? 0,
    blinds: { sb: opts.sb ?? 10, bb: opts.bb ?? 20, ante: opts.ante ?? 0 },
    deck: opts.deck ?? shuffledDeck(seededRandomInt(7)),
  })
}

function awards(events: HandEvent[]) {
  return events.filter((e) => e.t === 'award')
}

function stacksOf(h: HandState) {
  return h.players.map((p) => p.stack)
}

describe('hand flow', () => {
  it('heads-up: button posts SB and acts first preflop, last postflop', () => {
    const { hand: h } = setup([1000, 1000], { button: 0 })
    expect(h.sbSeat).toBe(0)
    expect(h.bbSeat).toBe(1)
    expect(h.toAct).toBe(0)
    act(h, 0, { type: 'call' })
    expect(h.toAct).toBe(1) // опция BB
    act(h, 1, { type: 'check' })
    expect(h.street).toBe('flop')
    expect(h.toAct).toBe(1)
  })

  it('three-handed: UTG acts first, BB gets the option', () => {
    const { hand: h } = setup([1000, 1000, 1000], { button: 0 })
    expect(h.sbSeat).toBe(1)
    expect(h.bbSeat).toBe(2)
    expect(h.toAct).toBe(0)
    act(h, 0, { type: 'call' })
    act(h, 1, { type: 'call' })
    expect(h.toAct).toBe(2)
    const la = legalActions(h, 2)
    expect(la.canCheck).toBe(true)
    expect(la.canRaise).toBe(true)
    expect(la.minTo).toBe(40)
  })

  it('minimum raise follows the last full raise', () => {
    const { hand: h } = setup([5000, 5000, 5000], { button: 0 })
    act(h, 0, { type: 'raise', to: 70 }) // +50
    expect(legalActions(h, 1).minTo).toBe(120)
    expect(() => act(h, 1, { type: 'raise', to: 100 })).toThrow()
    act(h, 1, { type: 'raise', to: 200 }) // +130
    expect(legalActions(h, 2).minTo).toBe(330)
  })

  it('incomplete all-in raise does not reopen betting', () => {
    // UTG 1000, SB 1000, BB 130.
    const { hand: h } = setup([1000, 1000, 130], { button: 0 })
    act(h, 0, { type: 'raise', to: 100 }) // полный рейз +80
    act(h, 1, { type: 'call' })
    act(h, 2, { type: 'allin' }) // до 130: +30, неполный
    expect(h.toAct).toBe(0)
    const la = legalActions(h, 0)
    expect(la.canCall).toBe(true)
    expect(la.canRaise).toBe(false)
  })

  it('cumulative short all-ins that add up to a full raise reopen betting', () => {
    const { hand: h } = setup([1000, 1000, 1000, 150, 200], { button: 0 })
    // кнопка 0, SB 1, BB 2, первым ходит 3
    act(h, 3, { type: 'allin' }) // 150: рейз +130 (полный), minRaise 130
    act(h, 4, { type: 'allin' }) // 200: +50 неполный
    act(h, 0, { type: 'call' }) // колл 200
    act(h, 1, { type: 'fold' })
    act(h, 2, { type: 'call' })
    // все сравнялись, улица закрыта
    expect(h.street).toBe('flop')
  })

  it('returns an uncalled bet', () => {
    const { hand: h } = setup([1000, 300], { button: 0 })
    act(h, 0, { type: 'raise', to: 1000 })
    const ev = act(h, 1, { type: 'call' })
    const unc = ev.find((e) => e.t === 'uncalled')
    expect(unc).toMatchObject({ seat: 0, amount: 700 })
    expect(h.done).toBe(true)
    expect(stacksOf(h).reduce((a, b) => a + b)).toBe(1300)
  })

  it('builds side pots and pays each one to the right player', () => {
    // 4 игрока, все в олл-ин с разными стеками. Лучшая рука у самого короткого.
    const holes: Record<number, [Card, Card]> = {
      0: ['As', 'Ad'], // 100
      1: ['Ks', 'Kd'], // 300
      2: ['Qs', 'Qd'], // 600
      3: ['2c', '7h'], // 1000
    }
    const deck = rigged([0, 1, 2, 3], 3, holes, ['3h', '8c', '9d', 'Jc', '4s'])
    const { hand: h } = setup([100, 300, 600, 1000], { button: 3, deck })
    // кнопка 3, SB 0, BB 1, первым ходит 2
    act(h, 2, { type: 'allin' })
    act(h, 3, { type: 'call' })
    act(h, 0, { type: 'allin' })
    const ev = act(h, 1, { type: 'allin' })
    expect(h.done).toBe(true)
    const pots = awards(ev)
    expect(pots.map((p) => p.amount)).toEqual([400, 600, 600])
    expect(pots[0]!.winners).toEqual([{ seat: 0, amount: 400 }])
    expect(pots[1]!.winners).toEqual([{ seat: 1, amount: 600 }])
    expect(pots[2]!.winners).toEqual([{ seat: 2, amount: 600 }])
    expect(stacksOf(h)).toEqual([400, 600, 600, 400])
  })

  it('splits a pot and gives the odd chip left of the button', () => {
    const holes: Record<number, [Card, Card]> = {
      0: ['2c', '3d'],
      1: ['2d', '3c'],
      2: ['7h', '8h'],
    }
    // доска даёт стрит всем, у 2 нет преимущества… делаем доску бродвеем.
    const deck = rigged([0, 1, 2], 2, holes, ['Ts', 'Js', 'Qd', 'Kc', 'Ah'])
    const { hand: h } = setup([1000, 1000, 1005], { button: 2, sb: 5, bb: 10, deck })
    // кнопка 2, SB 0, BB 1, первым ходит 2
    act(h, 2, { type: 'raise', to: 25 })
    act(h, 0, { type: 'call' })
    act(h, 1, { type: 'fold' })
    // банк 25 + 25 + 10 = 60, поровну по 30
    while (!h.done) act(h, h.toAct!, { type: 'check' })
    expect(stacksOf(h)).toEqual([1005, 990, 1010])
  })

  it('odd chip goes to the first winner left of the button', () => {
    const holes: Record<number, [Card, Card]> = {
      0: ['2c', '3d'],
      1: ['2d', '3c'],
      2: ['4h', '5h'],
    }
    const deck = rigged([0, 1, 2], 2, holes, ['Ts', 'Js', 'Qd', 'Kc', 'Ah'])
    const { hand: h } = setup([1000, 1000, 1000], { button: 2, sb: 5, bb: 10, deck })
    // SB сбрасывает, банк 25 делят BB и баттон: 13 получает первый слева от баттона (BB)
    act(h, 2, { type: 'call' })
    act(h, 0, { type: 'fold' })
    act(h, 1, { type: 'check' })
    while (!h.done) act(h, h.toAct!, { type: 'check' })
    expect(stacksOf(h)).toEqual([995, 1003, 1002])
  })

  it('reveals hands and runs the board out when everyone is all-in', () => {
    const { hand: h } = setup([500, 500], { button: 0 })
    act(h, 0, { type: 'allin' })
    const ev = act(h, 1, { type: 'call' })
    const kinds = ev.map((e) => e.t)
    expect(kinds.indexOf('reveal')).toBeLessThan(kinds.indexOf('board'))
    expect(ev.filter((e) => e.t === 'board')).toHaveLength(3)
    expect(h.done).toBe(true)
  })

  it('short big blind still makes others call the full blind', () => {
    const { hand: h } = setup([1000, 1000, 15], { button: 0 })
    expect(h.players[2]!.allIn).toBe(true)
    expect(legalActions(h, 0).toCall).toBe(20)
  })
})

describe('game', () => {
  it('runs a tournament to a single winner with conserved chips', () => {
    const rand = seededRandomInt(99)
    const g = createGame({ ...DEFAULT_CONFIG, startingStack: 300, levelMinutes: 1 })
    for (let i = 0; i < 5; i++) addPlayer(g, { id: `p${i}`, name: `P${i}` })
    let now = 0
    let guard = 0
    while (!g.finished && guard++ < 5000) {
      now += 15_000
      startNextHand(g, now, rand)
      while (g.hand && !g.hand.done) {
        const h = g.hand
        const p = h.players.find((x) => x.seat === h.toAct)!
        const la = legalFor(g, p.id)!
        const r = rand(10)
        if (r < 2 && la.canRaise) applyAction(g, p.id, { type: 'allin' })
        else if (la.canCheck) applyAction(g, p.id, { type: 'check' })
        else if (r < 7) applyAction(g, p.id, { type: 'call' })
        else applyAction(g, p.id, { type: 'fold' })
        expect(chipsInPlay(g)).toBe(1500)
      }
    }
    expect(g.finished).toBe(true)
    const places = g.players.map((p) => p.place).sort()
    expect(places).toEqual([1, 2, 3, 4, 5])
  })

  it('cash game rebuys after a bust', () => {
    const g = createGame({ ...DEFAULT_CONFIG, format: 'cash', startingStack: 100 })
    addPlayer(g, { id: 'a', name: 'A' })
    addPlayer(g, { id: 'b', name: 'B' })
    const rand = seededRandomInt(3)
    while (g.players.every((p) => p.status !== 'busted')) {
      startNextHand(g, 0, rand)
      while (g.hand && !g.hand.done) {
        const p = g.hand.players.find((x) => x.seat === g.hand!.toAct)!
        applyAction(g, p.id, legalFor(g, p.id)!.canRaise ? { type: 'allin' } : { type: 'call' })
      }
    }
    const loser = g.players.find((p) => p.status === 'busted')!
    expect(canStartHand(g)).toBe(false)
    rebuy(g, loser.id)
    expect(loser.stack).toBe(100)
    expect(loser.buyIns).toBe(2)
    expect(canStartHand(g)).toBe(true)
  })

  it('property: random play always conserves chips and finishes hands', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 9 }), fc.integer(), fc.array(fc.integer({ min: 1, max: 4000 }), { minLength: 9, maxLength: 9 }), (n, seed, stacks) => {
        const rand = seededRandomInt(seed)
        const { hand: h } = startHand({
          handNo: 1,
          seats: stacks.slice(0, n).map((stack, seat) => ({ id: `p${seat}`, seat, stack })),
          button: rand(n),
          blinds: { sb: 10, bb: 20, ante: rand(2) * 2 },
          deck: shuffledDeck(rand),
        })
        const total = stacks.slice(0, n).reduce((a, b) => a + b, 0)
        let steps = 0
        while (!h.done) {
          if (steps++ > 500) throw new Error('hand did not finish')
          const la = legalActions(h, h.toAct!)
          const r = rand(6)
          if (r === 0) act(h, la.seat, { type: 'fold' })
          else if (r === 1 && la.canRaise) act(h, la.seat, { type: 'raise', to: la.minTo + rand(Math.max(1, la.maxTo - la.minTo + 1)) })
          else if (r === 2 && la.canRaise) act(h, la.seat, { type: 'allin' })
          else if (la.canCheck) act(h, la.seat, { type: 'check' })
          else act(h, la.seat, { type: 'call' })
          const sum = h.players.reduce((s, p) => s + p.stack + p.committed, 0)
          if (sum !== total) throw new Error(`chips drifted: ${sum} != ${total}`)
        }
        return h.players.reduce((s, p) => s + p.stack, 0) === total
      }),
      { numRuns: 3000 },
    )
  })
})
