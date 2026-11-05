import { AnimatePresence, motion } from 'motion/react'
import { memo, useMemo, useState } from 'react'
import { Rabbit } from '@phosphor-icons/react'
import { equity } from '../../../engine/index.ts'
import type { TableView } from '../../../protocol/index.ts'
import { formatEquity } from '../lib/format'
import { send } from '../net/connection'
import { useApp } from '../store/app'
import type { Pt, Scene } from '../store/scene'
import { BOARD_CARD, BOARD_Y, boardSlot } from './geometry'

/**
 * Шансы живых рук. Считаются, когда видны карты всех, кто ещё в раздаче:
 * у игроков это олл-ин со вскрытием, у зрителей с открытыми картами всегда.
 * Каждый клиент считает сам по тому, что уже показано на столе, поэтому числа идут в ногу с доской.
 */
export function useEquity(scene: Scene): Map<number, number> | null {
  const live = Object.values(scene.seats).filter((s) => !s.folded)
  const known = live.every((s) => s.cards?.length === 2 && s.cards.every((c) => !!c))
  const active = scene.live && live.length >= 2 && known && scene.board.length < 5
  const key = active ? `${live.map((s) => `${s.seat}:${s.cards!.join('')}`).join('|')}/${scene.board.join('')}` : ''
  return useMemo(() => {
    if (!key) return null
    const seats = live.map((s) => s.seat)
    const eq = equity(
      live.map((s) => s.cards as string[]),
      scene.board,
    )
    return new Map(seats.map((seat, i) => [seat, eq[i]!]))
    // Пересчёт только при смене карт: ключ их и описывает.
  }, [key])
}

export const EquityBadge = memo(function EquityBadge({ at, value, leader, name }: { at: Pt; value: number; leader: boolean; name: string }) {
  const reduce = useApp((s) => s.settings.reduceMotion)
  const text = formatEquity(value)
  return (
    <div className="equity-anchor" style={{ left: at.x, top: at.y }}>
      <motion.div
        className={`equity ${leader ? 'is-leader' : ''} ${value <= 0 ? 'is-dead' : ''}`}
        initial={{ opacity: 0, scale: reduce ? 1 : 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 460, damping: 30 }}
        role="status"
        aria-label={`Шансы, ${name}: ${text}`}
      >
        <span className="equity__value num">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={text}
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -6 }}
              transition={{ duration: 0.14 }}
            >
              {text}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="equity__bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
        </span>
      </motion.div>
    </div>
  )
})

/** Середина пустых мест доски, начиная с `from`. */
function emptyCenter(from: number): Pt {
  const a = boardSlot(Math.min(4, from))
  const b = boardSlot(4)
  return { x: (a.x + b.x) / 2, y: BOARD_Y }
}

/**
 * Кнопка «Кролик» над пустыми местами доски, пока раздача, кончившаяся раньше ривера, лежит на столе.
 * Карты увидят все, а следующая раздача немного подождёт.
 */
export function RabbitButton({ view, scene }: { view: TableView; scene: Scene }) {
  const [asked, setAsked] = useState<number | null>(null)
  const hand = view.hand
  const show =
    view.phase === 'playing' &&
    view.config.game === 'holdem' &&
    !!hand &&
    hand.done &&
    hand.rabbit === null &&
    hand.handNo === scene.handNo &&
    !scene.live &&
    !scene.rabbit &&
    scene.board.length < 5
  const at = emptyCenter(scene.board.length)
  const pending = asked === hand?.handNo
  return (
    <AnimatePresence>
      {show && (
        <div className="rabbit-anchor" style={{ left: at.x, top: at.y }} key={`rabbit-${hand.handNo}`}>
          <motion.button
            className="rabbit-btn"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, delay: 0.15 }}
            disabled={pending}
            onClick={() => {
              setAsked(hand.handNo)
              send({ t: 'rabbit', handNo: hand.handNo })
            }}
            title="Показать, какие карты легли бы на стол дальше"
          >
            <Rabbit size={20} weight="duotone" />
            Кролик
          </motion.button>
        </div>
      )}
    </AnimatePresence>
  )
}

/** Подпись над картами «кролика»: кто попросил. */
export function RabbitCaption({ view, scene }: { view: TableView; scene: Scene }) {
  const r = scene.rabbit
  const name = r ? (view.players.find((p) => p.id === r.by)?.name ?? null) : null
  const at = emptyCenter(scene.board.length)
  return (
    <AnimatePresence>
      {r && (
        <motion.div
          className="rabbit-caption"
          style={{ left: at.x, top: BOARD_Y - BOARD_CARD.h / 2 - 20 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <Rabbit size={16} weight="duotone" />
          {name ? `Кролик · ${name}` : 'Кролик'}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
