import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { BjAction } from '../../../engine/index.ts'
import { sound } from '../audio/sound'
import { chips } from '../lib/format'
import { native } from '../lib/native'
import { send } from '../net/connection'
import { useApp } from '../store/app'
import { useBj } from '../store/bjscene'

const KEYS: Record<string, BjAction['type']> = { KeyH: 'hit', KeyS: 'stand', KeyD: 'double', KeyP: 'split' }
const LABEL: Record<BjAction['type'], string> = { hit: 'Ещё', stand: 'Хватит', double: 'Удвоить', split: 'Разделить' }
const KEY_HINT: Record<BjAction['type'], string> = { hit: 'H', stand: 'S', double: 'D', split: 'P' }

/** Ставки и ходы в блэкджеке. */
export function BjBar() {
  const view = useApp((s) => s.view)
  const rejected = useApp((s) => s.rejected)
  const toAct = useBj((s) => s.toAct)
  const presented = useBj((s) => s.bj)
  const bj = view?.bj ?? null
  const you = useApp((s) => s.you)
  const heroSeat = view?.players.find((p) => p.id === you)?.seat ?? null
  const me = view?.players.find((p) => p.id === you)
  const [amount, setAmount] = useState(0)
  const [sent, setSent] = useState<string | null>(null)
  const lastBet = useRef<number | null>(null)

  const min = bj?.minBet ?? 0
  const max = Math.min(bj?.maxBet ?? 0, me?.stack ?? 0)
  const canBet = !!bj && bj.you.canBet && bj.you.bet === null && !view?.paused
  const legal = bj?.you.legal ?? null
  const myTurn = !!legal && toAct?.seat === heroSeat && !view?.paused
  const key = `${bj?.roundNo}:${bj?.phase}:${toAct?.seat}:${toAct?.hand}:${presented?.seats.find((s) => s.seat === heroSeat)?.hands.map((h) => h.cards.length).join(',')}`

  useEffect(() => setSent(null), [rejected])
  useEffect(() => {
    if (canBet) setAmount(Math.min(max, Math.max(min, lastBet.current ?? min)))
  }, [canBet, bj?.roundNo]) // eslint-disable-line react-hooks/exhaustive-deps

  function act(action: BjAction) {
    if (!bj) return
    send({ t: 'bj', round: bj.roundNo, action })
    setSent(key)
    native?.flash(false)
    sound.play('select', { volume: 0.25 })
  }

  function bet() {
    if (!bj) return
    const a = Math.max(min, Math.min(max, Math.round(amount)))
    lastBet.current = a
    send({ t: 'bj', round: bj.roundNo, action: { type: 'bet', amount: a } })
    sound.play('chipsStack', { volume: 0.6 })
  }

  const showActions = myTurn && sent !== key
  useEffect(() => {
    if (!showActions || !legal) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const type = KEYS[e.code]
      if (type && legal[type]) {
        e.preventDefault()
        act({ type } as BjAction)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const myHand = presented?.seats.find((s) => s.seat === heroSeat)?.hands[toAct?.hand ?? 0]

  return (
    <div className="actionbar-host">
      <AnimatePresence mode="wait">
        {canBet && (
          <motion.div key="bet" className="bjbar panel" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16, transition: { duration: 0.15 } }}>
            <div className="bjbar__head">
              <span>Ставка на раунд</span>
              <span className="bjbar__amount num">{chips(amount)}</span>
            </div>
            <div className="bjbar__chips">
              {[1, 2, 5, 10].map((m) => {
                const v = Math.min(max, min * m)
                return (
                  <button key={m} className={`chip-btn ${amount === v ? 'is-on' : ''}`} onClick={() => setAmount(v)} disabled={min * m > max && m > 1}>
                    {chips(min * m)}
                  </button>
                )
              })}
            </div>
            <input
              type="range"
              className="range"
              min={min}
              max={Math.max(min, max)}
              step={min}
              value={amount}
              style={{ '--fill': `${max > min ? ((amount - min) / (max - min)) * 100 : 100}%` } as React.CSSProperties}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Размер ставки"
            />
            <button className="btn btn--lg btn--primary" onClick={bet}>
              Поставить <span className="num">{chips(amount)}</span>
            </button>
          </motion.div>
        )}
        {!canBet && bj?.phase === 'betting' && bj.you.bet !== null && (
          <motion.div key="wait" className="bjbar__wait" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            Ставка {chips(bj.you.bet)} принята, ждём остальных
          </motion.div>
        )}
        {showActions && legal && (
          <motion.div key="act" className="bjbar panel" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16, transition: { duration: 0.15 } }}>
            {myHand && (
              <div className="bjbar__head">
                <span>У тебя</span>
                <span className="bjbar__amount num">{myHand.soft && myHand.total < 21 ? `${myHand.total - 10}/${myHand.total}` : myHand.total}</span>
              </div>
            )}
            <div className="bjbar__buttons">
              {(['hit', 'stand', 'double', 'split'] as const)
                .filter((t) => legal[t])
                .map((t) => (
                  <button key={t} className={`btn btn--lg act-btn ${t === 'hit' ? 'btn--primary' : ''}`} onClick={() => act({ type: t } as BjAction)}>
                    {LABEL[t]} <span className="kbd">{KEY_HINT[t]}</span>
                  </button>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
