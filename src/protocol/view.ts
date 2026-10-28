import type {
  Blinds,
  Card,
  GameConfig,
  GameEvent,
  LegalActions,
  PlayerStatus,
  ShowdownHand,
  Street,
  ActionKind,
} from '../engine/index.ts'

export type Phase = 'lobby' | 'playing' | 'finished'

export interface PlayerView {
  id: string
  name: string
  color: string
  seat: number | null
  stack: number
  status: PlayerStatus | 'spectator'
  isBot: boolean
  isHost: boolean
  connected: boolean
  ping: number | null
  buyIns: number
  place: number | null
  hasAvatar: boolean
}

export interface SeatInHand {
  seat: number
  id: string
  bet: number
  folded: boolean
  allIn: boolean
  /** Карты видны: свои, вскрытые на шоудауне или показанные. */
  cards: Card[] | null
  lastAction: { kind: ActionKind | 'post' | 'allin'; amount: number } | null
}

export interface HandView {
  handNo: number
  button: number
  sbSeat: number | null
  bbSeat: number
  blinds: Blinds
  street: Street
  board: Card[]
  /** Всё, что уже в банке, без ставок текущей улицы. */
  pot: number
  seats: SeatInHand[]
  toAct: number | null
  currentBet: number
  minRaise: number
  done: boolean
  showdown: ShowdownHand[] | null
  winners: number[]
}

export interface TurnView {
  seat: number
  /** Сколько мс осталось на момент отправки. */
  remainingMs: number
  totalMs: number
}

export interface TableView {
  phase: Phase
  paused: boolean
  /** Вход новым участникам закрыт хостом. */
  locked: boolean
  code: string
  hostId: string
  config: GameConfig
  players: PlayerView[]
  handNo: number
  level: number
  blinds: Blinds
  /** Через сколько мс вырастут блайнды (на момент отправки). */
  nextLevelInMs: number | null
  hand: HandView | null
  turn: TurnView | null
  /** Следующая раздача начнётся через… (мс), если ждём. */
  nextHandInMs: number | null
  /** Итоги: места турнира или плюс/минус в кэше, включая ушедших. */
  results: { id: string; name: string; color: string; place: number | null; net: number; buyIns: number }[]
  you: {
    id: string
    legal: LegalActions | null
    canRebuy: boolean
    canShow: boolean
  }
}

/** Событие для анимации. Хост дополняет движковые события своими. */
export type ViewEvent =
  | Exclude<GameEvent, { t: 'deal' }>
  | { t: 'deal'; order: number[]; yours: Card[] | null }
  | { t: 'turn'; seat: number; totalMs: number }
  | { t: 'timeout'; seat: number }
  | { t: 'show'; seat: number; cards: Card[] }
  | { t: 'joined'; id: string; name: string }
  | { t: 'left'; id: string; name: string }
