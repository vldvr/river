import { create } from 'zustand'
import type { Card } from '../../../engine/index.ts'
import type { TableView } from '../../../protocol/index.ts'

export interface Pt {
  x: number
  y: number
}

export type SeatLabelKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin' | 'post' | 'timeout' | 'win'

export interface SceneSeat {
  seat: number
  id: string
  stack: number
  bet: number
  folded: boolean
  allIn: boolean
  /** null: карт нет; иначе по картe на позицию, null = рубашкой вверх. */
  cards: (Card | null)[] | null
  label: { kind: SeatLabelKind; amount: number } | null
  handName: string | null
}

export interface Flight {
  id: number
  kind: 'card' | 'chips'
  from: Pt
  to: Pt
  amount: number
  delay: number
  duration: number
  /** Для карт: поворот при посадке, градусы. */
  rotate?: number
  small?: boolean
}

export interface Banner {
  title: string
  subtitle: string
}

export interface Scene {
  handNo: number
  live: boolean
  button: number | null
  board: Card[]
  pot: number
  seats: Record<number, SceneSeat>
  toAct: number | null
  /** performance.now(), когда закончится время хода. */
  turnEndsAt: number | null
  turnTotal: number
  winners: number[]
  best: Card[] | null
  banner: Banner | null
  flights: Flight[]
  /** Номер «поколения» раздачи: меняется, когда сцена пересобрана целиком. */
  epoch: number
}

interface SceneStore extends Scene {
  set(p: Partial<Scene>): void
  patchSeat(seat: number, p: Partial<SceneSeat> | ((s: SceneSeat) => Partial<SceneSeat>)): void
  addFlight(f: Omit<Flight, 'id'>): void
  removeFlight(id: number): void
  syncFromView(view: TableView): void
}

const empty: Scene = {
  handNo: 0,
  live: false,
  button: null,
  board: [],
  pot: 0,
  seats: {},
  toAct: null,
  turnEndsAt: null,
  turnTotal: 1,
  winners: [],
  best: null,
  banner: null,
  flights: [],
  epoch: 0,
}

let flightSeq = 0

export const useScene = create<SceneStore>((set, get) => ({
  ...empty,
  set(p) {
    set(p)
  },
  patchSeat(seat, p) {
    const cur = get().seats[seat]
    if (!cur) return
    const patch = typeof p === 'function' ? p(cur) : p
    set({ seats: { ...get().seats, [seat]: { ...cur, ...patch } } })
  },
  addFlight(f) {
    set({ flights: [...get().flights, { ...f, id: ++flightSeq }] })
  },
  removeFlight(id) {
    set({ flights: get().flights.filter((f) => f.id !== id) })
  },
  syncFromView(view) {
    set(sceneFromView(view, get()))
  },
}))

/** Точная сцена по состоянию хоста: применяется после анимаций и при входе. */
export function sceneFromView(view: TableView, prev: Scene): Partial<Scene> {
  const h = view.hand
  if (!h) {
    return { ...empty, epoch: prev.epoch + 1, flights: [] }
  }
  const stackOf = (id: string) => view.players.find((p) => p.id === id)?.stack ?? 0
  const seats: Record<number, SceneSeat> = {}
  const showdown = new Map((h.showdown ?? []).map((s) => [s.seat, s]))
  for (const s of h.seats) {
    seats[s.seat] = {
      seat: s.seat,
      id: s.id,
      stack: stackOf(s.id),
      bet: s.bet,
      folded: s.folded,
      allIn: s.allIn,
      cards: s.folded ? null : s.cards ? [...s.cards] : [null, null],
      label: s.lastAction ? { kind: s.lastAction.kind, amount: s.lastAction.amount } : null,
      handName: showdown.get(s.seat)?.name ?? null,
    }
  }
  const winnerBest = h.done && h.winners.length ? (showdown.get(h.winners[0]!)?.best ?? null) : null
  const sameHand = prev.handNo === h.handNo
  return {
    handNo: h.handNo,
    live: !h.done,
    button: h.button,
    board: [...h.board],
    pot: h.done ? 0 : h.pot,
    seats,
    toAct: view.turn && !view.paused ? view.turn.seat : null,
    turnEndsAt: view.turn ? performance.now() + view.turn.remainingMs : null,
    turnTotal: view.turn?.totalMs ?? 1,
    winners: [...h.winners],
    best: winnerBest,
    banner: h.done && sameHand ? prev.banner : null,
    epoch: sameHand ? prev.epoch : prev.epoch + 1,
  }
}
