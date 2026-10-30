import { create } from 'zustand'
import type { BjView } from '../../../protocol/index.ts'

export interface BjScene {
  bj: BjView | null
  /** Подписи над местами: «Ещё», «Перебор», «+40». Ключ: `${seat}:${hand}`. */
  labels: Record<string, { text: string; tone: 'plain' | 'win' | 'lose' }>
  toAct: { seat: number; hand: number } | null
  turnEndsAt: number | null
  turnTotal: number
  set(p: Partial<Omit<BjScene, 'set'>>): void
}

export const useBj = create<BjScene>((set) => ({
  bj: null,
  labels: {},
  toAct: null,
  turnEndsAt: null,
  turnTotal: 1,
  set: (p) => set(p),
}))
