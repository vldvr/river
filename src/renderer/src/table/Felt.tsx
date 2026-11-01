import { memo } from 'react'
import { FELT } from './geometry'
import type { Pt } from '../store/scene'

/**
 * Стол: кожаный борт, сукно и неподвижное пятно света лампы. Раньше пятно ездило к тому,
 * чей ход, и смешивалось через soft-light: на сукне от этого гуляли блики и полосы.
 * Чей ход, и так видно по кольцу таймера.
 */
export const Felt = memo(function Felt(_props: { focus?: Pt | null; calm?: boolean }) {
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
        <div className="lamp" />
        <div className="felt__mark">Ривер</div>
      </div>
    </div>
  )
})
