import { motion } from 'motion/react'
import { memo } from 'react'
import type { Card } from '../../../engine/index.ts'
import { useApp } from '../store/app'
import './cards.css'

const SUIT_PATH: Record<string, string> = {
  s: 'M50 6C50 6 9 35 9 60c0 13 10 21 22 21 8 0 14-4 17-10-1 10-5 18-14 23h32c-9-5-13-13-14-23 3 6 9 10 17 10 12 0 22-8 22-21C91 35 50 6 50 6Z',
  h: 'M50 90S8 62 8 34C8 19 19 8 32 8c8 0 15 5 18 12 3-7 10-12 18-12 13 0 24 11 24 26 0 28-42 56-42 56Z',
  d: 'M50 4c9 15 24 33 38 46-14 13-29 31-38 46-9-15-24-33-38-46C26 37 41 19 50 4Z',
  c: 'M50 8a18 18 0 0 1 16 27 18 18 0 1 1 1 33c-5 0-10-2-13-6 1 12 5 21 14 32H32c9-11 13-20 14-32-3 4-8 6-13 6a18 18 0 1 1 1-33A18 18 0 0 1 50 8Z',
}

export function SuitIcon({ suit, size, color }: { suit: string; size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ display: 'block' }}>
      <path d={SUIT_PATH[suit]} fill={color ?? 'currentColor'} />
    </svg>
  )
}

const RANK_LABEL: Record<string, string> = { T: '10' }
const SUIT_NAME: Record<string, string> = { s: 'пики', h: 'червы', d: 'бубны', c: 'трефы' }

export function suitColor(suit: string, fourColor: boolean): string {
  if (suit === 'h') return 'var(--suit-red)'
  if (suit === 'd') return fourColor ? 'var(--suit-blue)' : 'var(--suit-red)'
  if (suit === 'c') return fourColor ? 'var(--suit-green)' : 'var(--ink)'
  return 'var(--ink)'
}

interface Props {
  card: Card | null
  w: number
  h: number
  /** Карта не участвует в выигрышной комбинации. */
  dim?: boolean
  /** Карта в выигрышной пятёрке. */
  win?: boolean
  /** Появляется рубашкой и переворачивается (доска). */
  flipIn?: { delay: number; from: { x: number; y: number } }
  shadow?: { x: number; y: number }
  className?: string
}

export const PlayingCard = memo(function PlayingCard({ card, w, h, dim, win, flipIn, shadow, className }: Props) {
  const fourColor = useApp((s) => s.settings.fourColor)
  const faceUp = card !== null
  const rank = card ? (RANK_LABEL[card[0]!] ?? card[0]!) : ''
  const suit = card ? card[1]! : 's'
  const color = suitColor(suit, fourColor)
  const big = h >= 100
  const rankSize = Math.round(h * (rank.length > 1 ? 0.3 : 0.34))
  const sh = shadow ?? { x: 0, y: 6 }

  return (
    <motion.div
      className={`pcard ${className ?? ''}`}
      style={
        {
          width: w,
          height: h,
          '--sx': `${sh.x}px`,
          '--sy': `${sh.y}px`,
        } as React.CSSProperties
      }
      initial={flipIn ? { x: flipIn.from.x, y: flipIn.from.y, rotateY: 180, opacity: 0 } : false}
      animate={{
        x: 0,
        y: win ? -10 : 0,
        rotateY: faceUp ? 0 : 180,
        opacity: dim ? 0.42 : 1,
      }}
      transition={{
        x: { duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: flipIn?.delay ?? 0 },
        y: { duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: flipIn && !win ? flipIn.delay : 0 },
        opacity: { duration: 0.25, delay: flipIn && !dim ? flipIn.delay : 0 },
        rotateY: { duration: 0.5, ease: [0.65, 0, 0.35, 1], delay: flipIn ? flipIn.delay + 0.3 : 0 },
      }}
      aria-label={card ? `${rank} ${SUIT_NAME[suit]}` : 'карта рубашкой вверх'}
      role="img"
    >
      <div className={`pcard__face ${win ? 'is-win' : ''}`} style={{ color }}>
        {card && (
          <>
            <span className="pcard__rank num" style={{ fontSize: rankSize }}>
              {rank}
            </span>
            <span className="pcard__corner-suit">
              <SuitIcon suit={suit} size={Math.round(h * 0.17)} />
            </span>
            <span className="pcard__suit">
              <SuitIcon suit={suit} size={Math.round(h * (big ? 0.46 : 0.42))} />
            </span>
          </>
        )}
      </div>
      <div className="pcard__back" />
    </motion.div>
  )
})
