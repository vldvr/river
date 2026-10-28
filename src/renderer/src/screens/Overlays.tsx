import { AnimatePresence, motion } from 'motion/react'
import { Trophy } from '@phosphor-icons/react'
import type { TableView } from '../../../protocol/index.ts'
import { chips, signedChips } from '../lib/format'
import { isHost, send } from '../net/connection'
import { useApp } from '../store/app'
import { useScene } from '../store/scene'

const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 6, transition: { duration: 0.15 } },
  transition: { type: 'spring' as const, stiffness: 320, damping: 30 },
}

export function Results({ view }: { view: TableView }) {
  const host = isHost()
  const tournament = view.config.format === 'tournament'
  const rows = [...view.results].sort((a, b) =>
    tournament ? (a.place ?? 99) - (b.place ?? 99) : b.net - a.net,
  )
  const winner = tournament ? rows.find((r) => r.place === 1) : null
  return (
    <motion.div className="results panel" {...fade}>
      {winner ? (
        <div className="results__head">
          <Trophy size={40} weight="fill" className="results__trophy" />
          <h2>{winner.name} выигрывает турнир</h2>
        </div>
      ) : (
        <div className="results__head">
          <h2>Итоги игры</h2>
        </div>
      )}
      <ol className="results__list">
        {rows.map((r, i) => (
          <li key={r.id} className={i === 0 ? 'is-first' : ''}>
            <span className="results__place num">{tournament ? r.place : i + 1}</span>
            <span className="results__dot" style={{ background: r.color }} />
            <span className="results__name">{r.name}</span>
            <span className={`results__net num ${r.net > 0 ? 'is-plus' : r.net < 0 ? 'is-minus' : ''}`}>
              {tournament ? '' : signedChips(r.net)}
            </span>
          </li>
        ))}
      </ol>
      {host ? (
        <button className="btn btn--primary btn--lg" onClick={() => send({ t: 'again' })}>
          Ещё партию
        </button>
      ) : (
        <p className="results__wait">Хост может начать новую партию</p>
      )}
    </motion.div>
  )
}

/** Подсказки в центре стола: пауза, ожидание игроков. */
export function CenterNotice({ view }: { view: TableView }) {
  const live = useScene((s) => s.live)
  const host = isHost()
  let content: React.ReactNode = null

  if (view.phase === 'playing' && view.paused) {
    content = (
      <>
        <div className="notice__title">Пауза</div>
        {host ? (
          <button className="btn btn--primary" onClick={() => send({ t: 'pause', paused: false })}>
            Продолжить
          </button>
        ) : (
          <div className="notice__sub">Хост поставил игру на паузу</div>
        )}
      </>
    )
  } else if (view.phase === 'playing' && !live && !view.hand?.done && view.nextHandInMs === null) {
    const active = view.players.filter((p) => p.seat !== null && p.status === 'active' && p.stack > 0).length
    if (active < 2) {
      content = (
        <>
          <div className="notice__title">Ждём игроков</div>
          <div className="notice__sub">Нужно хотя бы двое с фишками за столом</div>
        </>
      )
    }
  } else if (view.phase === 'playing' && !live && view.nextHandInMs === null && view.hand?.done) {
    const active = view.players.filter((p) => p.seat !== null && p.status === 'active' && p.stack > 0).length
    if (active < 2) {
      content = (
        <>
          <div className="notice__title">Ждём игроков</div>
          <div className="notice__sub">Нужно хотя бы двое с фишками за столом</div>
        </>
      )
    }
  }

  return (
    <AnimatePresence>
      {content && (
        <motion.div className="notice" key="notice" {...fade}>
          {content}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Действия вне хода: докупка, вернуться за стол, показать карты. */
export function SideActions({ view }: { view: TableView }) {
  const you = useApp((s) => s.you)
  const live = useScene((s) => s.live)
  const me = view.players.find((p) => p.id === you)
  if (!me || view.phase !== 'playing') return null

  let content: React.ReactNode = null
  if (view.you.canRebuy) {
    content = (
      <div className="sideact panel">
        <span>Фишки закончились</span>
        <button className="btn btn--primary" onClick={() => send({ t: 'rebuy' })}>
          Докупить <span className="num">{chips(view.config.startingStack)}</span>
        </button>
      </div>
    )
  } else if (me.status === 'sittingOut') {
    content = (
      <div className="sideact panel">
        <span>Ты отошёл от стола</span>
        <button className="btn btn--primary" onClick={() => send({ t: 'sit', out: false })}>
          Вернуться
        </button>
      </div>
    )
  } else if (view.you.canShow && !live) {
    content = (
      <button className="btn sideact-show" onClick={() => send({ t: 'show' })}>
        Показать карты
      </button>
    )
  }

  return (
    <div className="sideact-host">
      <AnimatePresence>{content && <motion.div {...fade}>{content}</motion.div>}</AnimatePresence>
    </div>
  )
}
