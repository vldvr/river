import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ArrowCounterClockwise, GearSix, PencilSimple } from '@phosphor-icons/react'
import { Avatar } from '../components/Avatar'
import { ChipStack } from '../components/Chips'
import { Modal } from '../components/Modal'
import { PlayingCard } from '../components/PlayingCard'
import { formatCode } from '../lib/format'
import { isMac } from '../lib/native'
import { cancelJoin, createGame, forgetSavedGame, joinByAddress, joinByCode, resumeGame, savedGame } from '../net/connection'
import { useApp } from '../store/app'
import { ProfileEditor } from './ProfileEditor'
import { SettingsModal } from './SettingsModal'
import './home.css'

export function Home() {
  const profile = useApp((s) => s.profile)
  const conn = useApp((s) => s.conn)
  const role = useApp((s) => s.role)
  const code = useApp((s) => s.code)
  const error = useApp((s) => s.homeError)
  const version = useApp((s) => s.appVersion)
  const update = useApp((s) => s.update)
  const [digits, setDigits] = useState('')
  const [ipMode, setIpMode] = useState(false)
  const [address, setAddress] = useState('')
  const [editProfile, setEditProfile] = useState(false)
  const [settings, setSettings] = useState(false)
  const [saved, setSaved] = useState(() => savedGame())
  const needName = !profile.name.trim()
  const busy = conn === 'connecting'

  const join = () => {
    if (needName) return setEditProfile(true)
    if (ipMode) void joinByAddress(address)
    else if (digits.length === 6) void joinByCode(digits)
  }

  const create = () => {
    if (needName) return setEditProfile(true)
    createGame()
  }

  return (
    <div className={`home ${isMac ? 'is-mac' : ''}`}>
      <div className="home__drag" />
      <div className="home__glow" aria-hidden="true" />
      <HeroArt />

      <main className="home__main">
        <motion.h1 className="home__title" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
          Ривер
        </motion.h1>
        <p className="home__lede">Техасский холдем для своей компании. Один создаёт игру, остальные заходят по коду.</p>

        <button className="home__me" onClick={() => setEditProfile(true)}>
          <Avatar name={profile.name || '?'} color={profile.color} src={profile.avatar} size={40} />
          <span className="home__me-name">{profile.name.trim() || 'Как тебя зовут?'}</span>
          <PencilSimple size={16} className="home__me-edit" />
        </button>

        {saved && !busy && (
          <div className="home__resume">
            <div>
              <div className="home__resume-title">Незаконченная игра</div>
              <div className="home__resume-sub">
                Комната <span className="num">{formatCode(saved.code)}</span>, раздача {saved.game.handNo}
              </div>
            </div>
            <div className="home__resume-actions">
              <button className="btn btn--sm btn--primary" onClick={resumeGame}>
                <ArrowCounterClockwise size={16} /> Продолжить
              </button>
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  forgetSavedGame()
                  setSaved(null)
                }}
              >
                Забыть
              </button>
            </div>
          </div>
        )}

        <div className="home__actions">
          <button className="btn btn--primary btn--lg home__create" onClick={create} disabled={busy}>
            Создать игру
          </button>

          <div className="home__join">
            <div className="home__join-head">
              <span>{ipMode ? 'Войти по адресу' : 'Войти по коду'}</span>
              <button className="home__switch" onClick={() => setIpMode((m) => !m)} disabled={busy}>
                {ipMode ? 'По коду' : 'По IP'}
              </button>
            </div>
            <div className="home__join-row">
              {ipMode ? (
                <input
                  className="input home__ip num"
                  value={address}
                  placeholder="26.10.0.5:47474"
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && join()}
                  disabled={busy}
                  aria-label="Адрес хоста"
                />
              ) : (
                <CodeInput value={digits} onChange={setDigits} onSubmit={join} disabled={busy} />
              )}
              <button className="btn btn--lg" onClick={join} disabled={busy || (ipMode ? !address.trim() : digits.length !== 6)}>
                Войти
              </button>
            </div>
            <AnimatePresence mode="wait">
              {busy && role === 'guest' ? (
                <motion.div key="busy" className="home__status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <span className="pulse" />
                  {code ? `Ищем комнату ${formatCode(code)}` : 'Подключаемся'}
                  <button className="home__cancel" onClick={cancelJoin}>
                    Отмена
                  </button>
                </motion.div>
              ) : error ? (
                <motion.p key="err" className="form-error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {error}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <footer className="home__foot">
        <span className="num">Ривер {version}</span>
        {update.state === 'ready' && <span className="home__update">Готово обновление {update.version}: откроется после перезапуска</span>}
        {update.state === 'available' && <span className="home__update">Вышла версия {update.version}</span>}
      </footer>

      <button className="icon-btn home__settings" onClick={() => setSettings(true)} aria-label="Настройки">
        <GearSix size={22} />
      </button>

      <Modal open={editProfile} title="Профиль" onClose={() => setEditProfile(false)}>
        <ProfileEditor autoFocus />
        <button className="btn btn--primary" onClick={() => setEditProfile(false)} disabled={!profile.name.trim()}>
          Готово
        </button>
      </Modal>
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
    </div>
  )
}

function CodeInput({ value, onChange, onSubmit, disabled }: { value: string; onChange(v: string): void; onSubmit(): void; disabled?: boolean }) {
  // Одно настоящее поле под шестью ячейками: быстрый ввод и вставка «490 379» не теряют цифры.
  const [focused, setFocused] = useState(false)
  return (
    <label className={`code ${focused ? 'is-focused' : ''}`}>
      <input
        className="code__input"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-label="Код комнаты из шести цифр"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`code__cell num ${i === 3 ? 'is-gap' : ''} ${focused && i === Math.min(value.length, 5) ? 'is-active' : ''}`} aria-hidden="true">
          {value[i] ?? ''}
        </span>
      ))}
    </label>
  )
}

/** Угол стола под лампой: три карты переворачиваются один раз при открытии. */
function HeroArt() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 450)
    return () => clearTimeout(t)
  }, [])
  const cards = ['As', 'Kh', 'Qd']
  return (
    <div className="home__art" aria-hidden="true">
      <div className="home__felt" />
      <div className="home__cards">
        {cards.map((c, i) => (
          <motion.div
            key={c}
            className="home__card"
            initial={{ opacity: 0, y: 40, rotate: -4 + i * 7 }}
            animate={{ opacity: 1, y: 0, rotate: -10 + i * 10 }}
            transition={{ duration: 0.8, delay: 0.15 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
            style={{ zIndex: i }}
          >
            <PlayingCard card={shown ? c : null} w={150} h={210} shadow={{ x: 6 + i * 4, y: 16 }} />
          </motion.div>
        ))}
      </div>
      <div className="home__chips">
        <ChipStack amount={1750} size={46} />
      </div>
    </div>
  )
}
