// Отзывы игроков из приложения: кнопка «Сообщить о проблеме».
//
// POST /api/feedback {text, contact?, meta?} → {ok: true, id}
//
// Отзыв сразу ложится в базу сервера, а если заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID,
// в фоне приходит разработчику в Телеграм. Без них отзывы просто копятся в базе.
import { DatabaseSync } from 'node:sqlite'
import { ApiError } from './accounts.mjs'

export const FEEDBACK = {
  minText: 5,
  maxText: 3000,
  maxContact: 120,
  /** Отзывов с одного адреса за окно: хватит на «ой, ещё одно», но не на спам. */
  perIp: 3,
  ipWindowMs: 10 * 60_000,
  /** Сообщений в Телеграм за час со всего сервера. Остальное лежит в базе и уйдёт позже. */
  messagesPerHour: 30,
  /** Недоставленное досылаем столько времени, потом бросаем: отзыв всё равно лежит в базе. */
  retryForMs: 3 * 24 * 3600_000,
  retryBatch: 10,
}

/** Что приложение прикладывает к тексту. Остальные поля молча отбрасываем. */
const META = {
  version: 'Версия',
  platform: 'Система',
  screen: 'Экран',
  where: 'Откуда',
  error: 'Ошибка',
}

export function openFeedback(file = ':memory:', { telegram = null, fetch = globalThis.fetch, now = () => Date.now(), log = () => {} } = {}) {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL,
      text TEXT NOT NULL, contact TEXT, meta TEXT NOT NULL, delivered INTEGER);
  `)
  const q = {
    add: db.prepare('INSERT INTO feedback (created, text, contact, meta) VALUES (?, ?, ?, ?)'),
    delivered: db.prepare('UPDATE feedback SET delivered = ? WHERE id = ?'),
    get: db.prepare('SELECT * FROM feedback WHERE id = ?'),
    undelivered: db.prepare('SELECT * FROM feedback WHERE delivered IS NULL AND created > ? ORDER BY id LIMIT ?'),
  }
  const ready = !!telegram?.token && !!telegram?.chat
  const hits = new Map()
  let sent = []
  /** Сообщения, которые ещё уходят: тесты ждут их. */
  const pending = new Set()
  /** Номера отзывов в пути: повтор не отправит их второй раз. */
  const inFlight = new Set()

  /** Отправляет отзыв в фоне, если Телеграм настроен и часовой лимит не выбран. */
  function send(row) {
    const t = now()
    sent = sent.filter((x) => t - x < 3600_000)
    if (!ready || inFlight.has(row.id) || sent.length >= FEEDBACK.messagesPerHour) return
    sent.push(t)
    inFlight.add(row.id)
    const job = deliver(feedbackMessage(row.id, row.text, row.contact, JSON.parse(row.meta)))
      .then(() => q.delivered.run(now(), row.id))
      .catch((err) => log(`feedback #${row.id}: telegram failed: ${err?.message ?? err}`))
      .finally(() => {
        inFlight.delete(row.id)
        pending.delete(job)
      })
    pending.add(job)
  }

  /** Досылает то, что не ушло: Телеграм был недоступен или упёрлись в лимит. */
  function retry() {
    if (!ready) return
    for (const row of q.undelivered.all(now() - FEEDBACK.retryForMs, FEEDBACK.retryBatch)) send(row)
  }

  function submit(body, ip) {
    const text = clean(body.text, FEEDBACK.maxText)
    if (text.length < FEEDBACK.minText) throw new ApiError(400, 'text too short')
    const contact = clean(body.contact, FEEDBACK.maxContact) || null
    const meta = {}
    if (body.meta && typeof body.meta === 'object') {
      for (const k of Object.keys(META)) {
        const v = clean(body.meta[k], 200)
        if (v) meta[k] = v
      }
    }

    const t = now()
    if (ip) {
      const recent = (hits.get(ip) ?? []).filter((x) => t - x < FEEDBACK.ipWindowMs)
      if (recent.length >= FEEDBACK.perIp) throw new ApiError(429, 'slow down')
      recent.push(t)
      hits.set(ip, recent)
    }

    const id = Number(q.add.run(t, text, contact, JSON.stringify(meta)).lastInsertRowid)
    log(`feedback #${id}: ${text.length} chars${contact ? ', with contact' : ''}`)
    send({ id, text, contact, meta: JSON.stringify(meta) })
    return { ok: true, id }
  }

  async function deliver(text) {
    const res = await fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Обычный текст, без разметки: текст игрока не сломает сообщение.
      body: JSON.stringify({ chat_id: telegram.chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Telegram ${res.status}`)
  }

  return {
    submit,
    retry,
    get: (id) => q.get.get(id) ?? null,
    settle: () => Promise.allSettled([...pending]),
    close: () => db.close(),
  }
}

/** Сообщение разработчику: номер, текст игрока, как ответить и откуда он писал. */
export function feedbackMessage(id, text, contact, meta) {
  const info = Object.entries(META)
    .filter(([k]) => meta[k] && k !== 'error')
    .map(([k, label]) => `${label}: ${meta[k]}`)
    .join(' · ')
  return [
    `Ривер, отзыв №${id}`,
    '',
    text,
    '',
    `Контакт: ${contact ?? 'не оставил'}`,
    ...(info ? [info] : []),
    ...(meta.error ? [`Ошибка: ${meta.error}`] : []),
  ].join('\n')
}

function clean(v, max) {
  if (typeof v !== 'string') return ''
  // Управляющие символы, кроме перевода строки и табуляции, ни к чему.
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max)
}
