import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerAction } from '../../../engine/index.ts'
import { sound } from '../audio/sound'
import { chips } from '../lib/format'
import { native } from '../lib/native'
import { send } from '../net/connection'
import { useApp } from '../store/app'
import { useScene } from '../store/scene'

type Pre = 'none' | 'checkFold' | 'callAny'

export function ActionBar() {
  const view = useApp((s) => s.view)
  const you = useApp((s) => s.you)
  const toAct = useScene((s) => s.toAct)
  const sceneSeats = useScene((s) => s.seats)
  const scenePot = useScene((s) => s.pot)
  const live = useScene((s) => s.live)
  const handNo = useScene((s) => s.handNo)

  const heroSeat = view?.players.find((p) => p.id === you)?.seat ?? null
  const legal = view?.you.legal ?? null
  const hand = view?.hand ?? null
  const myTurn = !!legal && heroSeat !== null && toAct === heroSeat && legal.seat === heroSeat && !view?.paused
  const me = heroSeat !== null ? sceneSeats[heroSeat] : undefined
  const canPre = live && !!me && !me.folded && !me.allIn && !myTurn

  const [pre, setPre] = useState<Pre>('none')
  const [amount, setAmount] = useState(0)
  const [sentKey, setSentKey] = useState<string | null>(null)
  // Ключ хода: улица и доска нужны, иначе после прочеканной улицы следующий ход выглядел бы уже сделанным.
  const turnKey = `${handNo}:${hand?.street}:${hand?.board.length ?? 0}:${hand?.currentBet ?? 0}:${legal?.toCall ?? 0}:${legal?.minTo ?? 0}`

  // Новая раздача: пред-действия сбрасываются.
  useEffect(() => setPre('none'), [handNo])

  const potTotal = scenePot + Object.values(sceneSeats).reduce((s, x) => s + x.bet, 0)
  const step = Math.max(1, view?.blinds.sb ?? 1)

  const presets = useMemo(() => {
    if (!legal || !hand) return []
    const round = (x: number) => Math.round(x / step) * step
    const clamp = (x: number) => Math.max(legal.minTo, Math.min(legal.maxTo, x))
    const make = (f: number) =>
      clamp(round(legal.isBet ? potTotal * f : hand.currentBet + f * (potTotal + legal.toCall)))
    return [
      { label: '½ банка', to: make(0.5) },
      { label: '¾ банка', to: make(0.75) },
      { label: 'Банк', to: make(1) },
      { label: 'Олл-ин', to: legal.maxTo },
    ]
  }, [legal, hand, potTotal, step])

  useEffect(() => {
    if (myTurn && legal) setAmount(legal.minTo)
  }, [myTurn, legal?.minTo, turnKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function act(action: PlayerAction) {
    if (!hand) return
    send({ t: 'action', handNo: hand.handNo, action })
    setSentKey(turnKey)
    native?.flash(false)
    sound.play('select', { volume: 0.25 })
  }

  // Пред-действие срабатывает, как только подошёл ход.
  const preRef = useRef(pre)
  preRef.current = pre
  useEffect(() => {
    if (!myTurn || !legal) return
    const p = preRef.current
    if (p === 'none') return
    setPre('none')
    if (p === 'checkFold') act(legal.canCheck ? { type: 'check' } : { type: 'fold' })
    if (p === 'callAny') act(legal.canCheck ? { type: 'check' } : { type: 'call' })
  }, [myTurn, turnKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const waiting = sentKey === turnKey
  const visible = myTurn && !waiting

  const raiseAction = (): PlayerAction => (legal && amount >= legal.maxTo ? { type: 'allin' } : { type: 'raise', to: amount })

  useEffect(() => {
    if (!visible || !legal) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'text')) return
      if (e.code === 'KeyF') act({ type: 'fold' })
      else if (e.code === 'KeyC') act(legal.canCheck ? { type: 'check' } : { type: 'call' })
      else if ((e.code === 'KeyR' || e.code === 'Enter') && legal.canRaise) act(raiseAction())
      else if (e.code === 'ArrowUp' || e.code === 'ArrowRight') setAmount((a) => Math.min(legal.maxTo, a + (view?.blinds.bb ?? 1)))
      else if (e.code === 'ArrowDown' || e.code === 'ArrowLeft') setAmount((a) => Math.max(legal.minTo, a - (view?.blinds.bb ?? 1)))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // каждый рендер: нужны свежие amount и legal

  const fill = legal && legal.maxTo > legal.minTo ? ((amount - legal.minTo) / (legal.maxTo - legal.minTo)) * 100 : 100

  return (
    <div className="actionbar-host">
      <AnimatePresence mode="wait">
        {visible && legal && (
          <motion.div
            key="act"
            className="actionbar panel"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            {legal.canRaise && legal.maxTo > legal.minTo && (
              <div className="actionbar__sizing">
                <div className="actionbar__presets">
                  {presets.map((p) => (
                    <button key={p.label} className={`chip-btn ${amount === p.to ? 'is-on' : ''}`} onClick={() => setAmount(p.to)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="actionbar__slider">
                  <input
                    type="range"
                    className="range"
                    min={legal.minTo}
                    max={legal.maxTo}
                    step={step}
                    value={amount}
                    style={{ '--fill': `${fill}%` } as React.CSSProperties}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    onWheel={(e) => {
                      const d = (view?.blinds.bb ?? 1) * (e.deltaY < 0 ? 1 : -1)
                      setAmount((a) => Math.max(legal.minTo, Math.min(legal.maxTo, a + d)))
                    }}
                    aria-label="Размер ставки"
                  />
                  <input
                    className="input actionbar__amount num"
                    type="number"
                    min={legal.minTo}
                    max={legal.maxTo}
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value) || legal.minTo)}
                    onBlur={() => setAmount((a) => Math.max(legal.minTo, Math.min(legal.maxTo, a)))}
                    aria-label="Сумма"
                  />
                </div>
              </div>
            )}
            <div className="actionbar__buttons">
              <button className="btn btn--lg act-btn act-btn--fold" onClick={() => act({ type: 'fold' })}>
                Фолд <span className="kbd">F</span>
              </button>
              {legal.canCheck ? (
                <button className="btn btn--lg act-btn" onClick={() => act({ type: 'check' })}>
                  Чек <span className="kbd">C</span>
                </button>
              ) : (
                <button className="btn btn--lg act-btn" onClick={() => act({ type: 'call' })}>
                  {legal.callAmount < legal.toCall ? 'Олл-ин' : 'Колл'} <span className="num">{chips(legal.callAmount)}</span>
                </button>
              )}
              {legal.canRaise && (
                <button className="btn btn--lg btn--primary act-btn" onClick={() => act(raiseAction())}>
                  {amount >= legal.maxTo ? 'Олл-ин' : legal.isBet ? 'Бет' : 'Рейз до'} <span className="num">{chips(amount)}</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
        {!visible && canPre && (
          <motion.div
            key="pre"
            className="prebar"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
          >
            <PreToggle on={pre === 'checkFold'} onClick={() => setPre(pre === 'checkFold' ? 'none' : 'checkFold')}>
              Чек или фолд
            </PreToggle>
            <PreToggle on={pre === 'callAny'} onClick={() => setPre(pre === 'callAny' ? 'none' : 'callAny')}>
              Колл любой
            </PreToggle>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PreToggle({ on, onClick, children }: { on: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button className={`pre-btn ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={onClick}>
      <span className="pre-btn__box" />
      {children}
    </button>
  )
}
