import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { STAGE } from './geometry'

/** Сцена 1600×900, вписанная в окно целиком. */
export function Stage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      const scale = Math.min(width / STAGE.w, height / STAGE.h)
      setFit({ scale, x: (width - STAGE.w * scale) / 2, y: (height - STAGE.h * scale) / 2 })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className="stage-host">
      <div
        className="stage"
        style={{
          width: STAGE.w,
          height: STAGE.h,
          transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
