import {
  evaluateBest,
  fullDeck,
  rankOf,
  suitOf,
  type Card,
  type LegalActions,
  type PlayerAction,
  type RandomInt,
} from '../engine/index.ts'

export const BOT_NAMES = ['Бублик', 'Шпрот', 'Пряник', 'Сухарик', 'Кекс', 'Батон', 'Пельмень', 'Сырник', 'Вареник']

export interface BotInput {
  hole: Card[]
  board: Card[]
  legal: LegalActions
  pot: number
  bb: number
  opponents: number
  rand: RandomInt
}

/** Простой бот: прикидывает эквити и сравнивает с шансами банка. Для заполнения мест и тестов. */
export function botDecision(input: BotInput): PlayerAction {
  const { legal, pot, bb, rand } = input
  const equity = input.board.length === 0 ? preflopStrength(input.hole) : monteCarlo(input, 160)
  const r = rand(1000) / 1000
  const call = legal.callAmount
  const odds = call / Math.max(1, pot + call)

  if (legal.canRaise) {
    const strong = equity > 0.72 || (equity > 0.6 && r < 0.35)
    const bluff = legal.canCheck && r < 0.07
    if (strong || bluff) {
      const fraction = 0.5 + rand(60) / 100
      const target = legal.isBet ? pot * fraction : legal.minTo + pot * fraction * 0.6
      let to = Math.max(legal.minTo, Math.min(legal.maxTo, roundTo(target, bb)))
      if (equity > 0.85 && r < 0.25) to = legal.maxTo
      if (to >= legal.maxTo * 0.7) to = legal.maxTo
      return to >= legal.maxTo ? { type: 'allin' } : { type: 'raise', to }
    }
  }
  if (legal.canCheck) return { type: 'check' }
  if (equity >= odds + 0.04 || (call <= bb && equity > 0.3)) return { type: 'call' }
  return { type: 'fold' }
}

function roundTo(x: number, step: number): number {
  const s = Math.max(1, Math.round(step / 2))
  return Math.round(x / s) * s
}

/** Грубая оценка префлопа в духе формулы Чена, приведённая к 0..1. */
export function preflopStrength(hole: Card[]): number {
  const [a, b] = hole.map(rankOf).sort((x, y) => y - x) as [number, number]
  const suited = suitOf(hole[0]!) === suitOf(hole[1]!)
  const base = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2)
  let score = base(a)
  if (a === b) score = Math.max(5, score * 2)
  if (suited) score += 2
  const gap = a - b - 1
  if (a !== b) score -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5
  if (a !== b && gap <= 1 && a < 12) score += 1
  return Math.max(0.05, Math.min(1, (score + 1) / 21))
}

function monteCarlo(input: BotInput, iterations: number): number {
  const known = new Set([...input.hole, ...input.board])
  const rest = fullDeck().filter((c) => !known.has(c))
  const opps = Math.max(1, Math.min(3, input.opponents))
  let wins = 0
  for (let i = 0; i < iterations; i++) {
    const deck = [...rest]
    const draw = () => deck.splice(input.rand(deck.length), 1)[0]!
    const board = [...input.board]
    const oppHands: Card[][] = []
    for (let o = 0; o < opps; o++) oppHands.push([draw(), draw()])
    while (board.length < 5) board.push(draw())
    const mine = evaluateBest([...input.hole, ...board]).score
    let best = true
    let tie = false
    for (const h of oppHands) {
      const s = evaluateBest([...h, ...board]).score
      if (s > mine) {
        best = false
        break
      }
      if (s === mine) tie = true
    }
    if (best) wins += tie ? 0.5 : 1
  }
  return wins / iterations
}
