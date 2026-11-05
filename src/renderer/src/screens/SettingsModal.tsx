import { Lock } from '@phosphor-icons/react'
import { Modal } from '../components/Modal'
import { useEffect, useState } from 'react'
import type { Card } from '../../../engine/index.ts'
import { PlayingCard } from '../components/PlayingCard'
import { Switch } from '../components/Switch'
import { sound } from '../audio/sound'
import { native } from '../lib/native'
import { isOpen, UNLOCK_RULE, unlockHint, unlockLeft, type Unlock } from '../lib/cosmetics'
import { useApp, type Accent, type Deck, type Felt } from '../store/app'

const FELTS: { id: Felt; name: string; color: string; unlock: Unlock }[] = [
  { id: 'green', name: 'Зелёное', color: '#2c7a5c', unlock: {} },
  { id: 'blue', name: 'Синее', color: '#2b5f8c', unlock: {} },
  { id: 'wine', name: 'Бордовое', color: '#7b2d3c', unlock: {} },
  { id: 'graphite', name: 'Графит', color: '#55595b', unlock: { games: 5 } },
  { id: 'sea', name: 'Море', color: '#1f7e82', unlock: { rating: 1100 } },
]
const DECKS: { id: Deck; name: string; hint: string }[] = [
  { id: 'classic', name: 'Обычная', hint: 'Червы и бубны красные, пики и трефы чёрные' },
  { id: 'four', name: 'Четыре цвета', hint: 'Бубны синие, трефы зелёные: масти не спутать' },
  { id: 'filled', name: 'Цветные карты', hint: 'Вся карта в цвет масти' },
]
const ACCENTS: { id: Accent; name: string; color: string }[] = [
  { id: 'amber', name: 'Янтарь', color: '#f0b357' },
  { id: 'ice', name: 'Лёд', color: '#78c7d8' },
  { id: 'rose', name: 'Роза', color: '#e58a9b' },
]

export function SettingsModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const s = useApp((st) => st.settings)
  const set = useApp((st) => st.setSettings)
  const version = useApp((st) => st.appVersion)
  const update = useApp((st) => st.update)
  const profile = useApp((st) => st.profile)

  return (
    <Modal open={open} title="Настройки" onClose={onClose} width={480}>
      <div className="field">
        <span className="field__label">Громкость</span>
        <div className="row">
          <input
            type="range"
            className="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            style={{ '--fill': `${s.volume * 100}%` } as React.CSSProperties}
            onChange={(e) => set({ volume: Number(e.target.value), muted: false })}
            onPointerUp={() => sound.play('chipsStack', { volume: 0.8 })}
            aria-label="Громкость"
          />
          <span className="num settings__vol">{Math.round(s.volume * 100)}</span>
        </div>
      </div>

      <div className="row">
        <div className="row__text">
          <span>Сигнал о моём ходе</span>
          <span className="row__hint">Звук и мигание значка на панели задач</span>
        </div>
        <Switch checked={s.turnSound} onChange={(v) => set({ turnSound: v })} label="Сигнал о ходе" />
      </div>

      <div className="field">
        <span className="field__label">Скорость анимаций</span>
        <div className="segmented">
          <button aria-pressed={s.speed === 'normal'} onClick={() => set({ speed: 'normal' })}>
            Обычная
          </button>
          <button aria-pressed={s.speed === 'fast'} onClick={() => set({ speed: 'fast' })}>
            Быстрая
          </button>
        </div>
      </div>

      <div className="row">
        <div className="row__text">
          <span>Меньше движения</span>
          <span className="row__hint">Короткие переходы без полётов по дуге</span>
        </div>
        <Switch checked={s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} label="Меньше движения" />
      </div>

      <div className="field">
        <span className="field__label">Колода</span>
        <div className="segmented">
          {DECKS.map((d) => (
            <button key={d.id} aria-pressed={s.deck === d.id} onClick={() => set({ deck: d.id })}>
              {d.name}
            </button>
          ))}
        </div>
        <div className="settings__deck">
          {['s', 'h', 'd', 'c'].map((x) => (
            <PlayingCard key={x} card={`A${x}` as Card} w={34} h={48} shadow={{ x: 0, y: 2 }} />
          ))}
          <span className="row__hint">{DECKS.find((d) => d.id === s.deck)?.hint}</span>
        </div>
      </div>

      <div className="field">
        <span className="field__label">Быстрые ставки</span>
        <SizesInput label="Префлоп, BB" value={s.preflopSizes} max={100} onChange={(v) => set({ preflopSizes: v })} />
        <SizesInput label="Постфлоп, % банка" value={s.postflopSizes} max={1000} onChange={(v) => set({ postflopSizes: v })} />
        <span className="row__hint">До четырёх чисел через пробел. Щелчок по своему стеку, ставке или банку показывает суммы в больших блайндах.</span>
      </div>

      <div className="field">
        <span className="field__label">Цвет акцента</span>
        <div className="accent-swatches">
          {ACCENTS.map((a) => (
            <button key={a.id} className={`accent-swatch ${s.accent === a.id ? 'is-on' : ''}`} onClick={() => set({ accent: a.id })} aria-pressed={s.accent === a.id}>
              <span style={{ background: a.color }} />
              {a.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Сукно</span>
        <div className="felts">
          {FELTS.map((f) => {
            const open = isOpen(f.unlock, profile.rating, profile.ratingGames)
            return (
              <button
                key={f.id}
                className={`felt-swatch ${s.felt === f.id ? 'is-on' : ''} ${open ? '' : 'is-locked'}`}
                onClick={() => open && set({ felt: f.id })}
                aria-pressed={s.felt === f.id}
                disabled={!open}
                title={open ? f.name : unlockHint(f.unlock)}
                aria-label={open ? f.name : `${f.name}. ${unlockHint(f.unlock)}`}
              >
                <span style={{ background: `radial-gradient(circle at 40% 35%, ${f.color}, color-mix(in oklab, ${f.color} 60%, #000))` }}>
                  {!open && <Lock size={14} weight="bold" />}
                </span>
                {f.name}
                {!open && <small className="swatch__lock">{unlockLeft(f.unlock, profile.rating, profile.ratingGames)}</small>}
              </button>
            )
          })}
        </div>
        {FELTS.some((f) => !isOpen(f.unlock, profile.rating, profile.ratingGames)) && <span className="row__hint">{UNLOCK_RULE}</span>}
      </div>

      <div className="settings__foot">
        <span>
          Ривер <span className="num">{version}</span>
        </span>
        <button
          className="btn btn--sm"
          onClick={() => {
            onClose()
            useApp.setState({ notes: { seen: null, all: true } })
          }}
        >
          Что нового
        </button>
        {update.state === 'ready' && (
          <button className="btn btn--sm btn--primary" onClick={() => native?.update.install()}>
            Обновить до {update.version}
          </button>
        )}
        {update.state === 'downloading' && <span>Скачиваем {update.version}</span>}
        {update.state === 'available' && (
          <button className="btn btn--sm" onClick={() => native?.openExternal(update.url)}>
            Скачать {update.version}
          </button>
        )}
      </div>
    </Modal>
  )
}

/** Список размеров ставок одной строкой: «2 2,5 3 4». Неверное значение откатывается при уходе с поля. */
function SizesInput({ label, value, max, onChange }: { label: string; value: number[]; max: number; onChange(v: number[]): void }) {
  const show = (v: number[]) => v.map((x) => String(x).replace('.', ',')).join(' ')
  const [text, setText] = useState(show(value))
  useEffect(() => setText(show(value)), [value])

  function commit() {
    const parsed = text
      .split(/[\s;]+/)
      .map((x) => Number(x.replace(',', '.')))
      .filter((x) => Number.isFinite(x) && x > 0 && x <= max)
      .map((x) => Math.round(x * 10) / 10)
    const uniq = [...new Set(parsed)].sort((a, b) => a - b).slice(0, 4)
    if (uniq.length > 0) onChange(uniq)
    else setText(show(value))
  }

  return (
    <label className="row settings__sizes">
      <span>{label}</span>
      <input
        className="input num"
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={label}
      />
    </label>
  )
}
