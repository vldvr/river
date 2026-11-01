import { Lock } from '@phosphor-icons/react'
import { Modal } from '../components/Modal'
import { SuitIcon, suitColor } from '../components/PlayingCard'
import { Switch } from '../components/Switch'
import { sound } from '../audio/sound'
import { native } from '../lib/native'
import { isOpen, UNLOCK_RULE, unlockHint, unlockLeft, type Unlock } from '../lib/cosmetics'
import { useApp, type Accent, type Felt } from '../store/app'

const FELTS: { id: Felt; name: string; color: string; unlock: Unlock }[] = [
  { id: 'green', name: 'Зелёное', color: '#2c7a5c', unlock: {} },
  { id: 'blue', name: 'Синее', color: '#2b5f8c', unlock: {} },
  { id: 'wine', name: 'Бордовое', color: '#7b2d3c', unlock: {} },
  { id: 'graphite', name: 'Графит', color: '#55595b', unlock: { games: 5 } },
  { id: 'sea', name: 'Море', color: '#1f7e82', unlock: { rating: 1100 } },
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

      <div className="row">
        <div className="row__text">
          <span>Четырёхцветная колода</span>
          <span className="row__hint">Бубны синие, трефы зелёные: масти не спутать</span>
        </div>
        <div className="settings__suits">
          {['s', 'h', 'd', 'c'].map((x) => (
            <SuitIcon key={x} suit={x} size={18} color={suitColor(x, s.fourColor)} />
          ))}
          <Switch checked={s.fourColor} onChange={(v) => set({ fourColor: v })} label="Четырёхцветная колода" />
        </div>
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
