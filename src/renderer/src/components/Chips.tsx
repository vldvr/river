import { memo } from 'react'
import './chips.css'

const DENOMS: { v: number; c: string; e: string }[] = [
  { v: 100_000, c: '#c9a14a', e: '#2a1c08' },
  { v: 25_000, c: '#b8527e', e: '#f3ece0' },
  { v: 5_000, c: '#2c5aa0', e: '#f3ece0' },
  { v: 1_000, c: '#d9822b', e: '#2b1a0a' },
  { v: 500, c: '#6b3fa0', e: '#f3ece0' },
  { v: 100, c: '#262626', e: '#e8e2d6' },
  { v: 25, c: '#2f7d4c', e: '#f3ece0' },
  { v: 5, c: '#b8322f', e: '#f3ece0' },
  { v: 1, c: '#ece5d8', e: '#3d6fb0' },
]

/** Раскладывает сумму на стопки по номиналам: не больше трёх стопок по 9 фишек. */
export function breakdown(amount: number): { c: string; e: string; n: number }[][] {
  let left = Math.max(0, Math.round(amount))
  const cols: { c: string; e: string; n: number }[][] = []
  for (const d of DENOMS) {
    if (left < d.v) continue
    const n = Math.floor(left / d.v)
    left -= n * d.v
    cols.push([{ c: d.c, e: d.e, n: Math.min(9, n) }])
    if (cols.length === 3) break
  }
  return cols
}

export const ChipStack = memo(function ChipStack({ amount, size = 28 }: { amount: number; size?: number }) {
  const cols = breakdown(amount)
  return (
    <div className="chipstack" style={{ '--d': `${size}px` } as React.CSSProperties} aria-hidden="true">
      {cols.map((col, ci) => (
        <div key={ci} className="chipstack__col" style={{ zIndex: 3 - ci }}>
          {col.flatMap((g) =>
            Array.from({ length: g.n }, (_, i) => (
              <span
                key={i}
                className="chip"
                style={{ '--c': g.c, '--e': g.e, transform: `translateY(${-i * size * 0.13}px)` } as React.CSSProperties}
              />
            )),
          )}
        </div>
      ))}
    </div>
  )
})
