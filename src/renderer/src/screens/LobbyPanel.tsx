import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Copy, Crown, Robot, X, CaretDown, SlidersHorizontal } from '@phosphor-icons/react'
import { UNLIMITED_REENTRIES, type GameConfig } from '../../../engine/index.ts'
import type { TableView } from '../../../protocol/index.ts'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { Switch } from '../components/Switch'
import { chips, formatCode, plural } from '../lib/format'
import { native } from '../lib/native'
import { disableDirect, enableDirect, isHost, rememberConfig, send } from '../net/connection'
import type { DirectInfo } from '../net/host'
import { useApp } from '../store/app'

export function LobbyPanel({ view }: { view: TableView }) {
  const host = isHost()
  const avatars = useApp((s) => s.avatars)
  const relay = useApp((s) => s.relay)
  const [editing, setEditing] = useState(false)
  const seated = view.players.filter((p) => p.seat !== null)
  const spectators = view.players.filter((p) => p.seat === null)
  const canStart = seated.length >= (view.config.game === 'blackjack' ? 1 : 2)

  const copy = () => {
    void navigator.clipboard.writeText(view.code)
    useApp.getState().toast('Код скопирован')
  }

  return (
    <motion.div
      className="lobby panel"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <section className="lobby__main">
        <span className="lobby__label">Код комнаты</span>
        <button className="lobby__code num" onClick={copy} title="Скопировать">
          {formatCode(view.code)}
          <Copy size={22} />
        </button>
        <p className="lobby__hint">Продиктуй код друзьям или скинь в чат. Они нажмут «Войти» и введут его.</p>
        {host && relay !== 'online' && (
          <p className="lobby__relay">
            {relay === 'connecting' ? 'Подключаемся к серверу комнат' : 'Нет связи с сервером комнат. Пробуем снова, а пока друзья не смогут войти по коду.'}
          </p>
        )}
        {host && native && <DirectBlock />}
      </section>

      <section className="lobby__side">
        <div className="lobby__count">
          {seated.length} {plural(seated.length, 'игрок', 'игрока', 'игроков')} из {view.config.maxSeats}
          {view.locked && <span className="lobby__locked">, вход закрыт</span>}
        </div>
        <ul className="lobby__players">
          {seated.map((p) => (
            <li key={p.id} className="lobby__player">
              <Avatar name={p.name} color={p.color} src={avatars[p.id]} size={28} dim={!p.connected} />
              <span className="lobby__pname">{p.name}</span>
              <span className="lobby__rating num" title={`Эло: ${p.rating}, партий: ${p.ratingGames}`}>
                Эло {p.rating}
              </span>
              {p.isHost && <Crown size={14} weight="fill" className="lobby__crown" aria-label="хост" />}
              {p.isBot && <Robot size={14} className="lobby__bot" aria-label="бот" />}
              {!p.isBot && !p.connected && <span className="lobby__off">нет связи</span>}
              {p.buyIns > 1 && <span className="lobby__off lobby__reentry">+{p.buyIns - 1}</span>}
              {host && !p.isHost && (
                <button className="lobby__kick" onClick={() => send({ t: 'kick', id: p.id })} aria-label={`Убрать ${p.name}`}>
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {spectators.length > 0 && <div className="lobby__spect">Смотрят: {spectators.map((p) => p.name).join(', ')}</div>}

        <div className="lobby__summary">
          <ConfigSummary config={view.config} />
          {host && (
            <button className="btn btn--sm btn--ghost" onClick={() => setEditing(true)}>
              <SlidersHorizontal size={16} /> Изменить
            </button>
          )}
        </div>

        <div className="lobby__actions">
          {host ? (
            <>
              <button className="btn" onClick={() => send({ t: 'addBot' })} disabled={seated.length >= view.config.maxSeats}>
                <Robot size={18} /> Бот
              </button>
              <button className="btn btn--primary btn--lg" onClick={() => send({ t: 'start' })} disabled={!canStart}>
                Начать игру
              </button>
            </>
          ) : (
            <p className="lobby__wait">Ждём, когда хост начнёт игру</p>
          )}
        </div>
      </section>
      {host && (
        <Modal open={editing} title="Настройки партии" onClose={() => setEditing(false)} width={520}>
          <ConfigForm config={view.config} />
        </Modal>
      )}
    </motion.div>
  )
}

const REENTRY_OPTIONS = [0, 1, 2, 3, UNLIMITED_REENTRIES]

function reentryText(n: number): string {
  if (n === 0) return 'без повторных входов'
  if (n >= UNLIMITED_REENTRIES) return 'повторные входы без лимита'
  return `повторных входов: ${n}`
}

function ConfigSummary({ config: c }: { config: GameConfig }) {
  if (c.game === 'blackjack') {
    const bj = [`Блэкджек, стек ${chips(c.startingStack)}`, `ставка от ${chips(c.bigBlind)}`, reentryText(c.reentries), `${c.turnSeconds} с на ход`]
    return <p className="lobby__rules">{bj.join(', ')}</p>
  }
  const parts = [
    c.format === 'tournament' ? 'Турнир' : 'Кэш-игра',
    `стек ${chips(c.startingStack)}`,
    `блайнды ${chips(c.smallBlind)}/${chips(c.bigBlind)}`,
    c.format === 'tournament' ? (c.levelMinutes ? `растут каждые ${c.levelMinutes} мин` : 'не растут') : null,
    reentryText(c.reentries),
    `${c.turnSeconds} с на ход`,
  ]
  return <p className="lobby__rules">{parts.filter(Boolean).join(', ')}</p>
}

function ConfigForm({ config }: { config: GameConfig }) {
  const [c, setC] = useState(config)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setC(config), [config])

  const update = (patch: Partial<GameConfig>) => {
    const next = { ...c, ...patch }
    setC(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const valid = next.smallBlind < next.bigBlind && next.bigBlind <= next.startingStack && next.startingStack >= 20 && next.bigBlind >= 2
      if (!valid) return
      send({ t: 'config', config: next })
      rememberConfig(next)
    }, 350)
  }
  const num = (v: string) => Math.max(0, Math.floor(Number(v.replace(/\s/g, '')) || 0))

  const bj = c.game === 'blackjack'
  return (
    <div className="cfg">
      <div className="field">
        <span className="field__label">Игра</span>
        <div className="segmented">
          <button aria-pressed={!bj} onClick={() => update({ game: 'holdem', maxSeats: 9 })}>
            Холдем
          </button>
          <button aria-pressed={bj} onClick={() => update({ game: 'blackjack', format: 'cash', maxSeats: 7 })}>
            Блэкджек
          </button>
        </div>
      </div>

      {bj ? (
        <>
          <label className="field">
            <span className="field__label">Стартовый стек</span>
            <input className="input num" inputMode="numeric" value={c.startingStack} onChange={(e) => update({ startingStack: num(e.target.value) })} />
          </label>
          <label className="field">
            <span className="field__label">Минимальная ставка</span>
            <input
              className="input num"
              inputMode="numeric"
              value={c.bigBlind}
              onChange={(e) => {
                const bb = num(e.target.value)
                update({ bigBlind: bb, smallBlind: Math.max(1, Math.floor(bb / 2)) })
              }}
            />
          </label>
        </>
      ) : (
        <>
      <div className="field">
        <span className="field__label">Формат</span>
        <div className="segmented">
          <button aria-pressed={c.format === 'tournament'} onClick={() => update({ format: 'tournament' })}>
            Турнир
          </button>
          <button aria-pressed={c.format === 'cash'} onClick={() => update({ format: 'cash' })}>
            Кэш-игра
          </button>
        </div>
      </div>

      <label className="field">
        <span className="field__label">Стартовый стек</span>
        <input className="input num" inputMode="numeric" value={c.startingStack} onChange={(e) => update({ startingStack: num(e.target.value) })} />
      </label>

      <div className="cfg__pair">
        <label className="field">
          <span className="field__label">Малый блайнд</span>
          <input className="input num" inputMode="numeric" value={c.smallBlind} onChange={(e) => update({ smallBlind: num(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field__label">Большой блайнд</span>
          <input className="input num" inputMode="numeric" value={c.bigBlind} onChange={(e) => update({ bigBlind: num(e.target.value) })} />
        </label>
      </div>

      {c.format === 'tournament' ? (
        <>
          <div className="field">
            <span className="field__label">Блайнды растут</span>
            <div className="segmented">
              {[0, 5, 10, 15, 20].map((m) => (
                <button key={m} aria-pressed={c.levelMinutes === m} onClick={() => update({ levelMinutes: m })}>
                  {m === 0 ? 'нет' : `${m} мин`}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <span>Анте с четвёртого уровня</span>
            <Switch checked={c.antes} onChange={(v) => update({ antes: v })} label="Анте" />
          </div>
        </>
      ) : null}
        </>
      )}

      <div className="field">
        <span className="field__label">{c.format === 'tournament' && !bj ? 'Повторные входы после вылета' : 'Докупки после вылета'}</span>
        <div className="segmented">
          {REENTRY_OPTIONS.map((n) => (
            <button key={n} aria-pressed={c.reentries === n} onClick={() => update({ reentries: n })}>
              {n === 0 ? 'нет' : n >= UNLIMITED_REENTRIES ? 'без лимита' : n}
            </button>
          ))}
        </div>
      </div>

      {!bj && (
        <div className="row">
          <div className="row__text">
            <span>Зрители видят карты</span>
            <span className="row__hint">Зрители и выбывшие смотрят раздачу с открытыми картами</span>
          </div>
          <Switch checked={c.spectatorsSeeCards !== false} onChange={(v) => update({ spectatorsSeeCards: v })} label="Зрители видят карты" />
        </div>
      )}

      <div className="field">
        <span className="field__label">Время на ход</span>
        <div className="segmented">
          {[15, 25, 40, 60].map((s) => (
            <button key={s} aria-pressed={c.turnSeconds === s} onClick={() => update({ turnSeconds: s })}>
              {s} с
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Мест за столом</span>
        <div className="segmented">
          {(bj ? [1, 3, 5, 7] : [2, 4, 6, 9]).map((n) => (
            <button key={n} aria-pressed={c.maxSeats === n} onClick={() => update({ maxSeats: n })}>
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const KIND: Record<string, string> = {
  lan: 'Локальная сеть',
  radmin: 'Radmin VPN',
  zerotier: 'ZeroTier',
  tailscale: 'Tailscale',
  hamachi: 'Hamachi',
  other: 'Другой адаптер',
}

function DirectBlock() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<DirectInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const turnOn = async () => {
    setBusy(true)
    setError(null)
    const r = await enableDirect()
    setBusy(false)
    if ('error' in r) setError(r.error === 'busy' ? 'Порт 47474 занят другой программой.' : 'Не получилось включить вход по IP.')
    else setInfo(r)
  }

  const copy = (s: string) => {
    void navigator.clipboard.writeText(s)
    useApp.getState().toast('Адрес скопирован')
  }

  return (
    <div className="direct">
      <button className="direct__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Друзья не могут подключиться?
        <CaretDown size={16} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }} />
      </button>
      {open && (
        <div className="direct__body">
          {!info ? (
            <>
              <p>
                Можно войти напрямую по IP. Windows спросит разрешение для брандмауэра, нажми «Разрешить». Игра попробует сама открыть порт на
                роутере.
              </p>
              <button className="btn btn--sm" onClick={turnOn} disabled={busy}>
                {busy ? 'Включаем' : 'Включить вход по IP'}
              </button>
              {error && <p className="direct__error">{error}</p>}
            </>
          ) : (
            <>
              <ul className="direct__list">
                {info.externalIp && (
                  <li>
                    <span>Интернет</span>
                    <button className="num" onClick={() => copy(`${info.externalIp}:${info.port}`)}>
                      {info.externalIp}:{info.port}
                    </button>
                  </li>
                )}
                {info.addresses.map((a) => (
                  <li key={a.address}>
                    <span>{KIND[a.kind]}</span>
                    <button className="num" onClick={() => copy(`${a.address}:${info.port}`)}>
                      {a.address}:{info.port}
                    </button>
                  </li>
                ))}
              </ul>
              {!info.externalIp && (
                <p className="direct__note">
                  Роутер не открыл порт сам. Если друзья не в одной сети с тобой, поставьте Radmin VPN, вступите в одну сеть и войдите по адресу Radmin.
                </p>
              )}
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  await disableDirect()
                  setInfo(null)
                }}
              >
                Выключить вход по IP
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
