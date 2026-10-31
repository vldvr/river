import type {
  BjEvent,
  BjLegal,
  BjResult,
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
  rating: number
  ratingGames: number
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

export interface BjHandView {
  cards: Card[]
  bet: number
  total: number
  soft: boolean
  doubled: boolean
  done: boolean
  result: BjResult | null
  payout: number
}

export interface BjView {
  roundNo: number
  phase: 'betting' | 'playing' | 'done'
  minBet: number
  maxBet: number
  dealer: { cards: (Card | null)[]; total: number | null; soft: boolean }
  /** В фазе ставок: все, кто может ставить; в игре: участники раунда. */
  seats: { seat: number; id: string; bet: number | null; hands: BjHandView[] }[]
  toAct: { seat: number; hand: number } | null
  shoeLeft: number
  you: { legal: BjLegal | null; canBet: boolean; bet: number | null }
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
  /** Блэкджек: текущий раунд. */
  bj: BjView | null
  turn: TurnView | null
  /** Следующая раздача начнётся через… (мс), если ждём. */
  nextHandInMs: number | null
  /** Итоги: места турнира или плюс/минус в кэше, включая ушедших. */
  results: { id: string; name: string; color: string; place: number | null; net: number; buyIns: number; rating: number; ratingDelta: number }[]
  you: {
    id: string
    /** Видит чужие карты как зритель. */
    spectator: boolean
    legal: LegalActions | null
    canRebuy: boolean
    /** Сколько повторных входов осталось (99: без ограничений). */
    reentriesLeft: number
    canShow: boolean
  }
}

/** Событие для анимации. Хост дополняет движковые события своими. */
export type ViewEvent =
  | Exclude<GameEvent, { t: 'deal' }>
  | { t: 'deal'; order: number[]; yours: Card[] | null }
  | { t: 'turn'; seat: number; totalMs: number }
  | BjEvent
  /** Блэкджек: начался ход (seat -1: время ставок). */
  | { t: 'bj_turn'; seat: number; hand: number; totalMs: number }
  | { t: 'timeout'; seat: number }
  | { t: 'show'; seat: number; cards: Card[] }
  | { t: 'joined'; id: string; name: string }
  | { t: 'left'; id: string; name: string }
