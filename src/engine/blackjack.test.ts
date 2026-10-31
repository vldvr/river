import { describe, expect, it } from 'vitest'
import { seededRandomInt, type Card } from './cards.ts'
import { bjAct, bjBotAction, bjDeal, bjLegal, bjTotal, isBlackjack, newRound } from './blackjack.ts'
import { bjAllBet, bjApply, bjBegin, bjBet, bjChips, bjCloseBets, bjLegalFor } from './bjgame.ts'
import { addPlayer, createGame, DEFAULT_CONFIG } from './game.ts'

/** Раунд с заданным шузом: карты раздаются по порядку (игроки, дилер, игроки, дилер, дальше добор). */
function round(bets: number[], shoe: Card[]) {
  const r = newRound(1)
  bets.forEach((b, i) => (r.bets[`p${i}`] = b))
  const players = bets.map((_, i) => ({ id: `p${i}`, seat: i }))
  const s = [...shoe]
  const events = bjDeal(r, players, s)
  return { r, s, events }
}

describe('blackjack rules', () => {
  it('counts totals and soft hands', () => {
    expect(bjTotal(['As', '6d'])).toEqual({ total: 17, soft: true })
    expect(bjTotal(['As', '6d', '9c'])).toEqual({ total: 16, soft: false })
    expect(bjTotal(['As', 'Ad', '9c'])).toEqual({ total: 21, soft: true })
    expect(bjTotal(['Ks', 'Qd', '2c'])).toEqual({ total: 22, soft: false })
    expect(isBlackjack(['As', 'Kd'])).toBe(true)
    expect(isBlackjack(['As', '5d', '5c'])).toBe(false)
  })

  it('pays a natural 3 to 2', () => {
    // Игрок: A K. Дилер: 9 7, стоит на 16? нет, добирает: 5 → 21? берём 2 → 18.
    const { r } = round([100], ['As', '9h', 'Kd', '7c', '2s'])
    expect(r.phase).toBe('done')
    expect(r.seats[0]!.hands[0]!.result).toBe('blackjack')
    expect(r.seats[0]!.hands[0]!.payout).toBe(250)
  })

  it('dealer stands on soft 17 and hits 16', () => {
    const a = round([10], ['Ts', 'As', '8d', '6c'])
    bjAct(a.r, 0, 1000, { type: 'stand' }, a.s)
    expect(a.r.dealer).toEqual(['As', '6c'])
    expect(a.r.seats[0]!.hands[0]!.result).toBe('win')

    const b = round([10], ['Ts', 'Th', '8d', '6c', '5s'])
    bjAct(b.r, 0, 1000, { type: 'stand' }, b.s)
    expect(b.r.dealer).toEqual(['Th', '6c', '5s'])
    expect(b.r.seats[0]!.hands[0]!.result).toBe('lose')
  })

  it('dealer blackjack ends the round, a player natural pushes', () => {
    const { r } = round([10, 10], ['As', 'Ts', 'Ah', 'Kd', '9c', 'Kh'])
    expect(r.phase).toBe('done')
    expect(r.seats[0]!.hands[0]!.result).toBe('push')
    expect(r.seats[1]!.hands[0]!.result).toBe('lose')
  })

  it('double draws one card and doubles the bet', () => {
    const { r, s } = round([20], ['5s', '9h', '6d', '7c', 'Ts', '2c'])
    const { extra } = bjAct(r, 0, 1000, { type: 'double' }, s)
    expect(extra).toBe(20)
    const h = r.seats[0]!.hands[0]!
    expect(h.cards).toHaveLength(3)
    expect(h.bet).toBe(40)
    // Дилер 9 7 = 16, берёт 2 → 18, у игрока 21.
    expect(h.result).toBe('win')
    expect(h.payout).toBe(80)
  })

  it('splits a pair into two hands, split aces get one card each', () => {
    const { r, s } = round([10], ['As', '9h', 'Ad', '8c', 'Ks', '5c'])
    expect(bjLegal(r, 0, 1000)!.split).toBe(true)
    bjAct(r, 0, 1000, { type: 'split' }, s)
    const hands = r.seats[0]!.hands
    expect(hands).toHaveLength(2)
    expect(hands.every((h) => h.cards.length === 2 && h.done)).toBe(true)
    // 21 после сплита это не блэкджек: платится 1 к 1.
    expect(hands[0]!.result).toBe('win')
    expect(hands[0]!.payout).toBe(20)
  })

  it('bot strategy never asks for an illegal action', () => {
    const legal = { hit: true, stand: true, double: false, split: false }
    expect(bjBotAction(['Ts', '6d'], 'Kc', legal).type).toBe('hit')
    expect(bjBotAction(['Ts', '6d'], '5c', legal).type).toBe('stand')
    expect(bjBotAction(['5s', '6d'], '5c', legal).type).toBe('hit')
  })
})

describe('blackjack game', () => {
  it('random rounds with bots conserve chips', () => {
    const rand = seededRandomInt(9)
    const g = createGame({ ...DEFAULT_CONFIG, game: 'blackjack', startingStack: 500, bigBlind: 10, smallBlind: 5, reentries: 0 })
    for (let i = 0; i < 4; i++) addPlayer(g, { id: `p${i}`, name: `P${i}` })
    let total = 2000
    for (let n = 0; n < 400; n++) {
      if (g.players.every((p) => p.status !== 'active')) break
      bjBegin(g, rand)
      for (const p of g.players.filter((x) => x.status === 'active')) bjBet(g, p.id, Math.min(p.stack, 10 * (1 + rand(5))))
      expect(bjAllBet(g)).toBe(true)
      bjCloseBets(g)
      let guard = 0
      while (g.bj!.phase === 'playing') {
        if (guard++ > 50) throw new Error('round did not finish')
        const seat = g.bj!.toAct!.seat
        const p = g.players.find((x) => x.seat === seat)!
        const legal = bjLegalFor(g, p.id)!
        const hand = g.bj!.seats.find((s) => s.seat === seat)!.hands[g.bj!.toAct!.hand]!
        bjApply(g, p.id, bjBotAction(hand.cards, g.bj!.dealer[0]!, legal))
        expect(bjChips(g)).toBeGreaterThan(0)
      }
      // Казино выигрывает или проигрывает: фишки игроков меняются ровно на итог раундов.
      const payouts = g.bj!.seats.reduce((s, x) => s + x.hands.reduce((a, h) => a + h.payout - h.bet, 0), 0)
      total += payouts
      expect(g.players.reduce((s, p) => s + p.stack, 0)).toBe(total)
    }
  })
})
