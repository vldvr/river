import { RELAY_URL } from '../net/relay'
import { useApp } from '../store/app'
import { isMac, isWindows, native } from './native'

/** Отзывы принимает тот же сервер, что держит комнаты и рейтинг. */
const API = RELAY_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/api')

/** Откуда игрок открыл окно отзыва: уходит вместе с текстом. */
export type FeedbackFrom = 'Настройки' | 'Главный экран' | 'За столом' | 'Ошибка'

export function openFeedback(where: FeedbackFrom, error?: string) {
  useApp.setState({ feedback: { where, error: error ?? null } })
}

export function closeFeedback() {
  useApp.setState({ feedback: null })
}

function platform(): string {
  const os = isMac ? 'macOS' : isWindows ? 'Windows' : 'Linux'
  return native ? os : `Браузер, ${os}`
}

/** Что уйдёт вместе с текстом. Окно показывает это игроку до отправки. */
export function feedbackMeta(): Record<string, string> {
  const s = useApp.getState()
  const meta: Record<string, string> = {
    version: s.appVersion,
    platform: platform(),
    screen: s.screen === 'game' ? 'Игра' : 'Главный экран',
  }
  if (s.feedback?.where) meta.where = s.feedback.where
  if (s.feedback?.error) meta.error = s.feedback.error
  return meta
}

export async function sendFeedback(text: string, contact: string): Promise<void> {
  const res = await fetch(`${API}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, contact: contact.trim() || undefined, meta: feedbackMeta() }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`feedback: ${res.status}`)
}
