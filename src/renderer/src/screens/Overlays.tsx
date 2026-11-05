import { AnimatePresence, motion } from 'motion/react'
import { Clover, Coins, Crown, Fire, Fish, HeartBreak, HourglassMedium, Mountains, Sword, Trophy, type Icon } from '@phosphor-icons/react'
import type { AwardKind, AwardView, TableView } from '../../../protocol/index.ts'
import { chips, formatEquity, plural, signedChips } from '../lib/format'
import { isHost, leaveGame, send } from '../net/connection'
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
  const awards = view.awards ?? []
  return (
    <motion.div className={`results panel ${awards.length ? 'has-awards' : ''}`} {...fade}>
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
            {r.buyIns > 1 && <span className="results__buyins">входов: {r.buyIns}</span>}
            <span className={`results__rating num ${r.ratingDelta > 0 ? 'is-plus' : r.ratingDelta < 0 ? 'is-minus' : ''}`}>
              {r.rating} ({r.ratingDelta >= 0 ? '+' : ''}{r.ratingDelta})
            </span>
            <span className={`results__net num ${r.net > 0 ? 'is-plus' : r.net < 0 ? 'is-minus' : ''}`}>
              {tournament ? '' : signedChips(r.net)}
            </span>
          </li>
        ))}
      </ol>
      {awards.length > 0 && <Awards awards={awards} />}
      {host ? (
        <div className="results__actions">
          <button className="btn btn--lg" onClick={() => leaveGame()}>
            Закрыть стол
          </button>
          <button className="btn btn--primary btn--lg" onClick={() => send({ t: 'again' })}>
            Ещё партию
          </button>
        </div>
      ) : (
        <p className="results__wait">Хост может начать новую партию</p>
      )}
    </motion.div>
  )
}

const AWARD: Record<AwardKind, { title: string; icon: Icon; detail(a: AwardView): string }> = {
  badBeat: { title: 'Бэд-бит', icon: HeartBreak, detail: (a) => `Проиграл с ${formatEquity(a.value)} в раздаче ${a.handNo}` },
  suckout: { title: 'Везунчик', icon: Clover, detail: (a) => `Выиграл с ${formatEquity(a.value)} в раздаче ${a.handNo}` },
  bestHand: { title: 'Лучшая рука', icon: Crown, detail: (a) => `${a.hand}, раздача ${a.handNo}` },
  bigPot: { title: 'Самый большой банк', icon: Coins, detail: (a) => `${chips(a.value)} · ${a.bb} BB, раздача ${a.handNo}` },
  allins: { title: 'Всё или ничего', icon: Fire, detail: (a) => `Олл-ин ${a.value} ${plural(a.value, 'раз', 'раза', 'раз')}` },
  aggro: { title: 'Агрессор', icon: Sword, detail: (a) => `${a.value} ${plural(a.value, 'бет или рейз', 'бета или рейза', 'бетов и рейзов')}` },
  loose: { title: 'Не может сбросить', icon: Fish, detail: (a) => `Играл ${Math.round(a.value * 100)}% раздач` },
  tight: { title: 'Скала', icon: Mountains, detail: (a) => `Играл всего ${Math.round(a.value * 100)}% раздач` },
  thinker: { title: 'Мыслитель', icon: HourglassMedium, detail: (a) => `В среднем ${Math.round(a.value / 1000)} с на ход` },
}

/** Номинации партии: кто чем запомнился. */
function Awards({ awards }: { awards: AwardView[] }) {
  const reduce = useApp((s) => s.settings.reduceMotion)
  return (
    <section className="awards" aria-label="Номинации">
      <h3 className="awards__title">Номинации</h3>
      <ul className="awards__grid">
        {awards.map((a, i) => {
          const info = AWARD[a.kind]
          if (!info) return null
          const Glyph = info.icon
          return (
            <motion.li
              key={a.kind}
              className={`award award--${a.kind}`}
              initial={{ opacity: 0, y: reduce ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.25 + i * 0.09, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="award__icon" aria-hidden="true">
                <Glyph size={22} weight="duotone" />
              </span>
              <span className="award__text">
                <span className="award__kind">{info.title}</span>
                <span className="award__name">
                  <span className="award__dot" style={{ background: a.color }} />
                  {a.name}
                </span>
                <span className="award__detail">{info.detail(a)}</span>
              </span>
            </motion.li>
          )
        })}
      </ul>
    </section>
  )
}

/** Подсказки в центре стола: пауза, ожидание игроков. */
export function CenterNotice({ view }: { view: TableView }) {
  const live = useScene((s) => s.live)
  const banner = useScene((s) => s.banner)
  const host = isHost()
  const ready = view.players.filter((p) => p.seat !== null && p.status === 'active' && p.stack > 0).length
  // В турнире, где уже есть места, один оставшийся означает конец партии, а не ожидание.
  const finishing = view.config.format === 'tournament' && view.players.some((p) => p.place !== null)
  const bj = view.config.game === 'blackjack'
  const need = bj ? 1 : 2
  const waiting = !view.paused && (bj ? !view.bj || view.bj.phase === 'done' : !live && !banner) && !finishing && view.nextHandInMs === null && ready < need

  let content: React.ReactNode = null
  if (view.paused) {
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
  } else if (view.ending) {
    content = (
      <>
        <div className="notice__title">Последняя раздача</div>
        <div className="notice__sub">Хост заканчивает игру: после неё будут итоги</div>
      </>
    )
  } else if (waiting) {
    content = (
      <>
        <div className="notice__title">Ждём игроков</div>
        <div className="notice__sub">{bj ? 'Нужен хотя бы один игрок с фишками' : 'Нужно хотя бы двое с фишками за столом'}</div>
      </>
    )
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
  // Пока доска докладывается после олл-ина, итог ещё никто не видел: ребай покажем после раздачи.
  if (view.you.canRebuy && !live) {
    const left = view.you.reentriesLeft
    content = (
      <div className="sideact panel">
        <span>
          Фишки закончились
          {left < 99 && <span className="sideact__hint">, {left === 1 ? 'остался последний вход' : `ещё ${left} входа`}</span>}
        </span>
        <button className="btn btn--primary" onClick={() => send({ t: 'rebuy' })}>
          {view.config.format === 'tournament' ? 'Войти снова' : 'Докупить'} <span className="num">{chips(view.config.startingStack)}</span>
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
