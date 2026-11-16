import { describe, expect, it } from 'vitest'
import { betInput, parseBetInput } from './betInput'

describe('ввод ставки', () => {
  it('принимает дробные BB с точкой и запятой', () => {
    expect(parseBetInput('2,5', 100)).toBe(250)
    expect(parseBetInput('2.5', 100)).toBe(250)
    expect(parseBetInput('250', 1)).toBe(250)
  })
  it('позволяет стереть сумму и начать дробное число', () => {
    expect(parseBetInput('', 100)).toBeNull()
    expect(parseBetInput('0,', 100)).toBe(0)
    expect(parseBetInput(',5', 100)).toBe(50)
    expect(parseBetInput('-5', 100)).toBeUndefined()
    expect(parseBetInput('1,2,3', 100)).toBeUndefined()
  })
  it('не теряет фишки при показе и повторном вводе суммы в BB', () => {
    for (const bb of [2, 3, 20, 75, 100, 150]) {
      for (const chips of [1, 25, 101, 999, 10001]) {
        expect(parseBetInput(betInput(chips, bb), bb)).toBe(chips)
      }
    }
  })
})
