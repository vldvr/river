import type { ViewEvent } from './view.ts'

/**
 * Длительности анимаций на обычной скорости, мс. Хост ждёт столько же,
 * прежде чем запустить таймер следующего хода, клиент по ним строит хореографию.
 */
export const T = {
  handStart: 500,
  post: 260,
  dealCard: 95,
  dealTail: 380,
  fold: 380,
  check: 320,
  bet: 480,
  uncalled: 420,
  collect: 600,
  flop: 1100,
  turnRiver: 700,
  /** Пауза перед улицей, когда руки уже вскрыты (олл-ин). */
  runoutSuspense: 900,
  reveal: 900,
  showdown: 1300,
  award: 1200,
  end: 500,
  bust: 900,
  show: 700,
  bjRound: 500,
  bjBet: 320,
  bjCard: 340,
  bjAct: 240,
  bjReveal: 650,
  bjResult: 420,
  bjEnd: 400,
} as const

/** Пауза между раздачами, чтобы рассмотреть итог. */
export const BETWEEN_HANDS_MS = 2600

export function eventDuration(e: ViewEvent, revealed: boolean): number {
  switch (e.t) {
    case 'start':
      return T.handStart
    case 'post':
      return T.post
    case 'deal':
      return e.order.length * 2 * T.dealCard + T.dealTail
    case 'act':
      return e.kind === 'fold' ? T.fold : e.kind === 'check' ? T.check : T.bet
    case 'uncalled':
      return T.uncalled
    case 'collect':
      return T.collect
    case 'board':
      return (e.street === 'flop' ? T.flop : T.turnRiver) + (revealed ? T.runoutSuspense : 0)
    case 'reveal':
      return T.reveal
    case 'showdown':
      return T.showdown
    case 'award':
      return T.award
    case 'end':
      return T.end
    case 'bust':
      return T.bust
    case 'show':
      return T.show
    case 'bj_round':
      return T.bjRound
    case 'bj_bet':
      return T.bjBet
    case 'bj_card':
      return T.bjCard
    case 'bj_act':
      return T.bjAct
    case 'bj_reveal':
      return T.bjReveal
    case 'bj_result':
      return T.bjResult
    case 'bj_end':
      return T.bjEnd
    default:
      return 0
  }
}

/** Сколько длится показ пачки событий (с учётом вскрытия рук на олл-ине). */
export function batchDuration(events: ViewEvent[]): number {
  let revealed = false
  let total = 0
  for (const e of events) {
    total += eventDuration(e, revealed)
    if (e.t === 'reveal') revealed = true
    if (e.t === 'start') revealed = false
  }
  return total
}
