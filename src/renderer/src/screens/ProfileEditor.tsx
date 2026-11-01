import { useRef, useState } from 'react'
import { Copy, ImageSquare, Lock, Trash } from '@phosphor-icons/react'
import { Avatar } from '../components/Avatar'
import { PlayingCard } from '../components/PlayingCard'
import { BACKS, isOpen, unlockHint, unlockLeft } from '../lib/cosmetics'
import { formatRecoveryCode, parseRecoveryCode } from '../lib/id'
import { avatarFromFile } from '../lib/image'
import { NoAccountError, restoreAccount } from '../net/rating'
import { PLAYER_COLORS, useApp } from '../store/app'

export function ProfileEditor({ autoFocus }: { autoFocus?: boolean }) {
  const profile = useApp((s) => s.profile)
  const setProfile = useApp((s) => s.setProfile)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      setError(null)
      setProfile({ avatar: await avatarFromFile(file) })
    } catch {
      setError('Не получилось открыть картинку. Подойдёт PNG, JPG или WebP.')
    }
  }

  return (
    <div className="profile">
      <div className="profile__avatar">
        <Avatar name={profile.name || '?'} color={profile.color} src={profile.avatar} size={72} />
        <div className="profile__avatar-actions">
          <button className="btn btn--sm" onClick={() => fileRef.current?.click()}>
            <ImageSquare size={16} /> {profile.avatar ? 'Другая картинка' : 'Своя картинка'}
          </button>
          {profile.avatar && (
            <button className="icon-btn" onClick={() => setProfile({ avatar: null })} aria-label="Убрать картинку">
              <Trash size={18} />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        </div>
      </div>
      <label className="field">
        <span className="field__label">Имя за столом</span>
        <input
          className="input"
          type="text"
          value={profile.name}
          maxLength={20}
          autoFocus={autoFocus}
          placeholder="Например, Лёша"
          onChange={(e) => setProfile({ name: e.target.value })}
        />
      </label>
      <div className="field">
        <span className="field__label">Цвет</span>
        <div className="colors">
          {PLAYER_COLORS.map((c) => (
            <button
              key={c}
              className={`color ${profile.color === c ? 'is-on' : ''}`}
              style={{ background: c }}
              onClick={() => setProfile({ color: c })}
              aria-label={`Цвет ${c}`}
              aria-pressed={profile.color === c}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label">Рубашка карт</span>
        <div className="backs">
          {BACKS.map((b) => {
            const open = isOpen(b.unlock, profile.rating, profile.ratingGames)
            const on = (profile.back ?? 'classic') === b.id
            return (
              <button
                key={b.id}
                className={`back-swatch ${on ? 'is-on' : ''} ${open ? '' : 'is-locked'}`}
                onClick={() => open && setProfile({ back: b.id })}
                disabled={!open}
                aria-pressed={on}
                title={open ? b.name : unlockHint(b.unlock)}
                aria-label={open ? b.name : `${b.name}. ${unlockHint(b.unlock)}`}
              >
                <span className="back-swatch__card">
                  <PlayingCard card={null} w={40} h={56} back={b.id} shadow={{ x: 0, y: 3 }} />
                  {!open && <Lock size={16} weight="bold" />}
                </span>
                {b.name}
                {!open && <small className="swatch__lock">{unlockLeft(b.unlock, profile.rating, profile.ratingGames)}</small>}
              </button>
            )
          })}
        </div>
        <span className="row__hint">Твою рубашку видят все за столом. Закрытые открываются за партии в зачёт и рейтинг: что считается, написано ниже.</span>
      </div>
      {error && <p className="form-error">{error}</p>}
      <RatingSection />
    </div>
  )
}

/** Рейтинг на сервере и код, по которому он вернётся на другом компьютере. */
function RatingSection() {
  const profile = useApp((s) => s.profile)
  const toast = useApp((s) => s.toast)
  const [shown, setShown] = useState(false)
  const [entering, setEntering] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const restore = async () => {
    const code = parseRecoveryCode(input)
    if (!code) return setError('В коде 20 знаков, например 7KQF-3MZP-T2WX-9HNC-AB4D')
    if (code === profile.secret) return setEntering(false)
    setBusy(true)
    setError(null)
    try {
      const me = await restoreAccount(code)
      toast(`Рейтинг восстановлен: Эло ${me.rating}`)
      setEntering(false)
      setInput('')
    } catch (err) {
      setError(err instanceof NoAccountError ? 'Такого кода нет. Проверь, нет ли опечатки.' : 'Сервер не отвечает. Проверь интернет и попробуй ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field rating-box">
      <span className="field__label">Рейтинг</span>
      <p className="rating-box__score">
        Эло <span className="num">{profile.rating}</span>
        <span className="rating-box__games">
          {profile.ratingGames === 0 ? 'Ещё нет партий в зачёт' : `Партий в зачёт: ${profile.ratingGames}`}
        </span>
      </p>
      <p className="row__hint">
        Рейтинг хранится на сервере. Считаются покер-партии от 15 раздач с другими людьми, без ботов. Код ниже вернёт рейтинг после переустановки или на другом компьютере: запиши его.
      </p>
      {shown ? (
        <div className="rating-box__code">
          <span className="num">{formatRecoveryCode(profile.secret)}</span>
          <button
            className="icon-btn"
            aria-label="Скопировать код"
            onClick={() => {
              void navigator.clipboard.writeText(formatRecoveryCode(profile.secret))
              toast('Код скопирован')
            }}
          >
            <Copy size={18} />
          </button>
        </div>
      ) : null}
      {entering ? (
        <div className="rating-box__enter">
          <input
            className="input num"
            type="text"
            value={input}
            maxLength={30}
            autoFocus
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void restore()}
            aria-label="Код восстановления"
          />
          <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => void restore()}>
            {busy ? 'Проверяем' : 'Войти'}
          </button>
          <button className="btn btn--sm" onClick={() => (setEntering(false), setError(null))}>
            Отмена
          </button>
        </div>
      ) : (
        <div className="rating-box__actions">
          <button className="btn btn--sm" onClick={() => setShown(!shown)}>
            {shown ? 'Скрыть код' : 'Показать код'}
          </button>
          <button className="btn btn--sm" onClick={() => setEntering(true)}>
            У меня есть код
          </button>
        </div>
      )}
      {entering && <p className="row__hint">Текущий рейтинг на этом компьютере сменится рейтингом из кода. Сохрани свой код, если он нужен.</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
