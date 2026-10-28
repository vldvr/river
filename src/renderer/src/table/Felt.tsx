import { motion } from 'motion/react'
import { memo } from 'react'
import { CENTER, FELT, lerp } from './geometry'
import type { Pt } from '../store/scene'

/** Стол: кожаный борт, сукно и пятно света лампы, которое тянется к тому, чей ход. */
export const Felt = memo(function Felt({ focus, calm }: { focus: Pt | null; calm: boolean }) {
  const target = focus ? lerp(CENTER, focus, 0.3) : CENTER
  return (
    <div className="felt-wrap" aria-hidden="true">
      <div className="room-light" />
      <div
        className="rail"
        style={{
          left: FELT.cx - FELT.rx - 46,
          top: FELT.cy - FELT.ry - 46,
          width: (FELT.rx + 46) * 2,
          height: (FELT.ry + 46) * 2,
        }}
      />
      <div
        className="felt"
        style={{
          left: FELT.cx - FELT.rx,
          top: FELT.cy - FELT.ry,
          width: FELT.rx * 2,
          height: FELT.ry * 2,
        }}
      >
        <div className="felt__line" />
        <motion.div
          className="lamp"
          initial={false}
          animate={{ x: target.x - CENTER.x, y: target.y - CENTER.y }}
          transition={calm ? { duration: 0 } : { duration: 1.1, ease: [0.65, 0, 0.35, 1] }}
        />
        <div className="felt__mark">Ривер</div>
      </div>
    </div>
  )
})
