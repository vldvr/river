import { describe, expect, it } from 'vitest'
import { accountId, openAccounts, RULES } from './accounts.mjs'
import { rankStandings, updateRatings } from './rating.mjs'

const A = 'AAAAAAAAAAAAAAAAAAAA'
const B = 'BBBBBBBBBBBBBBBBBBBB'
const C = 'CCCCCCCCCCCCCCCCCCCC'
const CODE = '123456'

function setup() {
  let t = 1_000_000
  const acc = openAccounts(':memory:', { now: () => t })
  const owns = (code, secret) => code === CODE && secret === 'room'
  return { acc, owns, tick: (ms) => (t += ms) }
}

describe('rating math', () => {
  it('is zero-sum and rewards the winner', () => {
    const changes = updateRatings([
      { id: 'w', rating: 1000, games: 0, rank: 1, score: 1 },
      { id: 'd', rating: 1000, games: 0, rank: 2, score: 0.5 },
      { id: 'l', rating: 1000, games: 0, rank: 3, score: 0 },
    ])
    expect(changes[0].rating).toBeGreaterThan(1000)
    expect(changes[2].rating).toBeLessThan(1000)
    expect(changes.reduce((s, c) => s + c.delta, 0)).toBe(0)
  })

  it('ranks players still in a tournament above the busted ones', () => {
    const r = rankStandings([
      { id: 'a', rating: 1000, games: 0, place: null, net: 500 },
      { id: 'b', rating: 1000, games: 0, place: null, net: 900 },
      { id: 'c', rating: 1000, games: 0, place: 3, net: -1000 },
    ])
    expect(r.map((x) => x.rank)).toEqual([2, 1, 3])
  })
})

describe('accounts', () => {
  it('derives the id from the code and keeps the rating', () => {
    const { acc } = setup()
    const me = acc.me({ secret: A })
    expect(me).toEqual({ id: accountId(A), rating: 1000, games: 0 })
    expect(() => acc.me({ secret: 'short' })).toThrow()
    expect(() => acc.me({ secret: B, existing: true })).toThrow('no account')
  })

  it('caps the rating carried over from old versions, only on first login', () => {
    const { acc } = setup()
    expect(acc.me({ secret: A, legacy: { rating: 2900, games: 40 } }).rating).toBe(RULES.legacyMax)
    expect(acc.me({ secret: A, legacy: { rating: 500, games: 1 } }).rating).toBe(RULES.legacyMax)
  })

  it('tickets are bound to a room', () => {
    const { acc } = setup()
    const { ticket, id } = acc.ticket({ secret: A, code: CODE })
    expect(acc.seat({ ticket, code: CODE }).id).toBe(id)
    expect(() => acc.seat({ ticket, code: '654321' })).toThrow()
    expect(() => acc.seat({ ticket: ticket.slice(0, -2) + 'xx', code: CODE })).toThrow()
  })
})

describe('game reports', () => {
  function play(hands, { final = true } = {}) {
    const s = setup()
    const ta = s.acc.ticket({ secret: A, code: CODE }).ticket
    const tb = s.acc.ticket({ secret: B, code: CODE }).ticket
    const players = [
      { ticket: ta, place: null, net: 300 },
      { ticket: tb, place: null, net: -300 },
    ]
    const first = s.acc.report({ code: CODE, secret: 'room', kind: 'cash', hands: 0, final: false, players }, s.owns)
    s.tick(hands * 10_000)
    const last = s.acc.report({ game: first.game, code: CODE, kind: 'cash', hands, final, players }, s.owns)
    return { ...s, first, last }
  }

  it('needs the room secret to open a game', () => {
    const { acc, owns } = setup()
    expect(() => acc.report({ code: CODE, secret: 'nope', kind: 'cash', hands: 0, final: false, players: [] }, owns)).toThrow()
  })

  it('rates a finished game once', () => {
    const { acc, last, first, owns } = play(30)
    expect(last.counted).toBe(true)
    expect(acc.me({ secret: A }).rating).toBeGreaterThan(1000)
    expect(acc.me({ secret: B }).rating).toBeLessThan(1000)
    const again = acc.report({ game: first.game, code: CODE, kind: 'cash', hands: 30, final: true, players: [] }, owns)
    expect(again.done).toBe(true)
    expect(acc.me({ secret: A }).games).toBe(1)
  })

  it('does not rate short games', () => {
    const { acc, last } = play(RULES.minHands - 1)
    expect(last.counted).toBe(false)
    expect(acc.me({ secret: A })).toMatchObject({ rating: 1000, games: 0 })
  })

  it('does not believe more hands than time allows', () => {
    const s = setup()
    const ta = s.acc.ticket({ secret: A, code: CODE }).ticket
    const tb = s.acc.ticket({ secret: B, code: CODE }).ticket
    const players = [
      { ticket: ta, place: null, net: 300 },
      { ticket: tb, place: null, net: -300 },
    ]
    const r = s.acc.report({ code: CODE, secret: 'room', kind: 'cash', hands: 500, final: true, players }, s.owns)
    expect(r.counted).toBe(false)
  })

  it('keeps players who left and settles abandoned games', () => {
    const s = setup()
    const ta = s.acc.ticket({ secret: A, code: CODE }).ticket
    const tb = s.acc.ticket({ secret: B, code: CODE }).ticket
    const tc = s.acc.ticket({ secret: C, code: CODE }).ticket
    const g = s.acc.report(
      { code: CODE, secret: 'room', kind: 'cash', hands: 0, final: false, players: [{ ticket: ta, place: null, net: 0 }, { ticket: tb, place: null, net: 0 }, { ticket: tc, place: null, net: -500 }] },
      s.owns,
    ).game
    s.tick(20 * 10_000)
    // C ушёл с минусом, в отчёте его больше нет.
    s.acc.report({ game: g, code: CODE, kind: 'cash', hands: 20, final: false, players: [{ ticket: ta, place: null, net: 400 }, { ticket: tb, place: null, net: 100 }] }, s.owns)
    s.tick(RULES.staleMs + 1)
    s.acc.settleStale()
    expect(s.acc.me({ secret: C }).rating).toBeLessThan(1000)
    expect(s.acc.me({ secret: A }).rating).toBeGreaterThan(1000)
  })

  it('ignores forged tickets', () => {
    const s = setup()
    const ta = s.acc.ticket({ secret: A, code: CODE }).ticket
    const r = s.acc.report({ code: CODE, secret: 'room', kind: 'cash', hands: 0, final: false, players: [{ ticket: ta, place: null, net: 0 }, { ticket: 'x.y', place: null, net: 0 }] }, s.owns)
    expect(r.done).toBe(false)
    s.tick(RULES.minHands * 10_000)
    const last = s.acc.report({ game: r.game, code: CODE, kind: 'cash', hands: RULES.minHands, final: true, players: [] }, s.owns)
    expect(last.counted).toBe(false)
  })
})
