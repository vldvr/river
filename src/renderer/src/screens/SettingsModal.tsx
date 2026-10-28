import { Modal } from '../components/Modal'
import { SuitIcon, suitColor } from '../components/PlayingCard'
import { Switch } from '../components/Switch'
import { sound } from '../audio/sound'
import { native } from '../lib/native'
import { useApp, type Felt } from '../store/app'

const FELTS: { id: Felt; name: string; color: string }[] = [
  { id: 'green', name: 'Зелёное', color: '#2c7a5c' },
  { id: 'blue', name: 'Синее', color: '#2b5f8c' },
  { id: 'wine', name: 'Бордовое', color: '#7b2d3c' },
]

export function SettingsModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const s = useApp((st) => st.settings)
  const set = useApp((st) => st.setSettings)
  const version = useApp((st) => st.appVersion)
  const update = useApp((st) => st.update)

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
        <span className="field__label">Сукно</span>
        <div className="felts">
          {FELTS.map((f) => (
            <button key={f.id} className={`felt-swatch ${s.felt === f.id ? 'is-on' : ''}`} onClick={() => set({ felt: f.id })} aria-pressed={s.felt === f.id}>
              <span style={{ background: `radial-gradient(circle at 40% 35%, ${f.color}, color-mix(in oklab, ${f.color} 60%, #000))` }} />
              {f.name}
            </button>
          ))}
        </div>
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
