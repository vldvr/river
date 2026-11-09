import { useState } from 'react'
import { Modal } from '../components/Modal'
import { closeFeedback, feedbackMeta, sendFeedback } from '../lib/feedback'
import { useApp } from '../store/app'

const LABELS: Record<string, string> = { version: 'версия', platform: 'система', screen: 'экран', where: 'откуда', error: 'ошибка' }
const MIN = 5

/** «Сообщить о проблеме»: текст уходит на сервер, а оттуда разработчику в Телеграм. */
export function FeedbackModal() {
  const state = useApp((s) => s.feedback)
  // Черновик живёт, пока окно закрыто: случайно закрыл, текст не пропал.
  const [text, setText] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const open = state !== null
  const meta = open ? feedbackMeta() : {}
  const ready = text.trim().length >= MIN && !busy

  const close = () => {
    setFailed(false)
    closeFeedback()
  }

  async function submit() {
    if (!ready) return
    setBusy(true)
    setFailed(false)
    try {
      await sendFeedback(text.trim(), contact)
      setText('')
      setContact('')
      closeFeedback()
      useApp.getState().toast('Спасибо! Отзыв отправлен')
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Сообщить о проблеме" onClose={close} width={500}>
      <label className="field">
        <span className="field__label">Что случилось или что сделать лучше</span>
        <textarea
          className="input feedback__text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          }}
          placeholder="Например: после олл-ина не показались карты соседа"
          maxLength={3000}
          rows={5}
          autoFocus
        />
      </label>
      <label className="field">
        <span className="field__label">Как с тобой связаться, если нужен ответ</span>
        <input
          className="input"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Телеграм или почта, можно не писать"
          maxLength={120}
        />
      </label>
      <p className="row__hint feedback__note">
        Отзыв прочитает только разработчик. Вместе с ним уйдёт контакт, если оставишь, и{' '}
        {Object.entries(meta)
          .map(([k, v]) => `${LABELS[k] ?? k}: ${v}`)
          .join(', ')}
        .
      </p>
      {failed && (
        <p className="form-error">Не отправилось: сервер не ответил. Текст не пропал, попробуй ещё раз чуть позже.</p>
      )}
      <div className="feedback__actions">
        <button className="btn" onClick={close}>
          Отмена
        </button>
        <button className="btn btn--primary" onClick={() => void submit()} disabled={!ready}>
          {busy ? 'Отправляем' : 'Отправить'}
        </button>
      </div>
    </Modal>
  )
}
