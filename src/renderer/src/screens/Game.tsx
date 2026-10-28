import { AnimatePresence } from 'motion/react'
import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { isMac } from '../lib/native'
import { isHost, leaveGame } from '../net/connection'
import { useApp } from '../store/app'
import { ActionBar } from '../table/ActionBar'
import { Table } from '../table/Table'
import { LobbyPanel } from './LobbyPanel'
import { CenterNotice, Results, SideActions } from './Overlays'
import { SettingsModal } from './SettingsModal'
import { SidePanel } from './SidePanel'
import { TopBar } from './TopBar'
import './game.css'

export function Game() {
  const view = useApp((s) => s.view)
  const [side, setSide] = useState(false)
  const [settings, setSettings] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyT' && (e.target as HTMLElement).tagName !== 'INPUT') setSide((s) => !s)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!view) {
    return (
      <div className={`game ${isMac ? 'is-mac' : ''}`}>
        <div className="game__loading">
          <span className="pulse" /> Садимся за стол
        </div>
      </div>
    )
  }

  const host = isHost()
  return (
    <div className={`game ${isMac ? 'is-mac' : ''}`}>
      <Table />
      <TopBar onSettings={() => setSettings(true)} onSide={() => setSide((s) => !s)} onLeave={() => setConfirmLeave(true)} />
      <div className="game__center">
        <AnimatePresence mode="wait">
          {view.phase === 'lobby' && <LobbyPanel key="lobby" view={view} />}
          {view.phase === 'finished' && <Results key="results" view={view} />}
        </AnimatePresence>
        {view.phase === 'playing' && <CenterNotice view={view} />}
      </div>
      {view.phase === 'playing' && <ActionBar />}
      <SideActions view={view} />
      <SidePanel open={side} onClose={() => setSide(false)} />
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
      <Modal open={confirmLeave} title={host ? 'Закончить игру?' : 'Выйти из игры?'} onClose={() => setConfirmLeave(false)} width={420}>
        <p className="confirm__text">
          {host
            ? 'Ты хост: если закончить игру, стол закроется у всех.'
            : view.phase === 'playing' && view.config.format === 'tournament'
              ? 'В турнире вернуться за стол уже не получится.'
              : 'Твоё место освободится.'}
        </p>
        <div className="confirm__actions">
          <button className="btn" onClick={() => setConfirmLeave(false)}>
            Остаться
          </button>
          <button
            className="btn btn--primary"
            onClick={() => {
              setConfirmLeave(false)
              leaveGame()
            }}
          >
            {host ? 'Закончить' : 'Выйти'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
