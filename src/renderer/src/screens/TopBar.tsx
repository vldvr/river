import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { ChatCircleText, DotsThree, GearSix, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react'
import { chips, clock, formatCode } from '../lib/format'
import { isMac } from '../lib/native'
import { send, isHost } from '../net/connection'
import { useApp } from '../store/app'

export function TopBar({ onSettings, onSide, onLeave }: { onSettings(): void; onSide(): void; onLeave(): void }) {
  const view = useApp((s) => s.view)
  const you = useApp((s) => s.you)
  const unread = useApp((s) => s.unread)
  const muted = useApp((s) => s.settings.muted)
  const setSettings = useApp((s) => s.setSettings)
  const conn = useApp((s) => s.conn)
  const [menu, setMenu] = useState(false)
  const [, tick] = useState(0)
  const receivedAt = useRef(performance.now())

  useEffect(() => {
    receivedAt.current = performance.now()
  }, [view])
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (!view) return null
  const me = view.players.find((p) => p.id === you)
  const host = isHost()
  const levelLeft = view.nextLevelInMs === null ? null : view.nextLevelInMs - (performance.now() - receivedAt.current)

  const copy = () => {
    void navigator.clipboard.writeText(view.code)
    useApp.getState().toast('Код скопирован')
  }

  return (
    <header className={`topbar ${isMac ? 'is-mac' : ''}`}>
      <div className="topbar__left">
        <span className="topbar__brand">Ривер</span>
        <button className="topbar__code" onClick={copy} title="Скопировать код">
          Комната <span className="num">{formatCode(view.code)}</span>
        </button>
        {view.phase === 'playing' && view.config.game === 'blackjack' && (
          <span className="topbar__blinds">
            Ставки от <span className="num">{chips(view.config.bigBlind)}</span> до <span className="num">{chips(view.config.bigBlind * 100)}</span>
          </span>
        )}
        {view.phase === 'playing' && view.config.game !== 'blackjack' && (
          <span className="topbar__blinds">
            Блайнды <span className="num">{chips(view.blinds.sb)}/{chips(view.blinds.bb)}</span>
            {view.blinds.ante > 0 && (
              <>
                , анте <span className="num">{chips(view.blinds.ante)}</span>
              </>
            )}
            {levelLeft !== null && (
              <span className="topbar__level">
                рост через <span className="num">{clock(levelLeft)}</span>
              </span>
            )}
          </span>
        )}
        {conn === 'reconnecting' && <span className="topbar__warn">Связь потеряна, переподключаемся</span>}
        {view.you.spectator && <span className="topbar__spect">Ты зритель: видны карты всех игроков</span>}
      </div>
      <div className="topbar__right">
        <button className="icon-btn" onClick={onSide} aria-label="Чат и история раздач">
          <ChatCircleText size={22} />
          {unread > 0 && <span className="dot" />}
        </button>
        <button className="icon-btn" onClick={() => setSettings({ muted: !muted })} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
          {muted ? <SpeakerSlash size={22} /> : <SpeakerHigh size={22} />}
        </button>
        <button className="icon-btn" onClick={onSettings} aria-label="Настройки">
          <GearSix size={22} />
        </button>
        <div className="menu-anchor">
          <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="Меню" aria-expanded={menu}>
            <DotsThree size={24} weight="bold" />
          </button>
          <AnimatePresence>
            {menu && (
              <motion.div
                className="menu panel"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
                transition={{ duration: 0.16 }}
                onMouseLeave={() => setMenu(false)}
              >
                {host && view.phase === 'playing' && (
                  <button
                    onClick={() => {
                      send({ t: 'pause', paused: !view.paused })
                      setMenu(false)
                    }}
                  >
                    {view.paused ? 'Продолжить игру' : 'Пауза'}
                  </button>
                )}
                {host && (
                  <button
                    onClick={() => {
                      send({ t: 'lock', locked: !view.locked })
                      setMenu(false)
                    }}
                  >
                    {view.locked ? 'Открыть вход в комнату' : 'Закрыть вход новым'}
                  </button>
                )}
                {me && me.seat !== null && view.phase === 'playing' && (me.status === 'active' || me.status === 'sittingOut') && (
                  <button
                    onClick={() => {
                      send({ t: 'sit', out: me.status === 'active' })
                      setMenu(false)
                    }}
                  >
                    {me.status === 'active' ? 'Отойти от стола' : 'Вернуться за стол'}
                  </button>
                )}
                <button
                  className="is-danger"
                  onClick={() => {
                    setMenu(false)
                    onLeave()
                  }}
                >
                  {host ? 'Закончить игру' : 'Выйти из игры'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  )
}
