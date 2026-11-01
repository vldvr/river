import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { ChatTeardropText } from '@phosphor-icons/react'
import { REACTIONS } from '../../../protocol/index.ts'
import { react } from '../net/connection'

/** Быстрые фразы над своим местом. Клавиши 1–8, пока меню открыто. */
export function Reactions() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const pick = (i: number) => {
    react(i)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (n >= 1 && n <= REACTIONS.length) pick(n - 1)
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <div className="react" ref={ref}>
      <AnimatePresence>
        {open && (
          <motion.div
            className="react__menu panel"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
            transition={{ duration: 0.16 }}
          >
            {REACTIONS.map((text, i) => (
              <button key={text} onClick={() => pick(i)}>
                {text}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <button className="icon-btn icon-btn--lg" onClick={() => setOpen(!open)} aria-label="Реакции" aria-expanded={open} title="Реакции">
        <ChatTeardropText size={24} />
      </button>
    </div>
  )
}
