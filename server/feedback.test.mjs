import { afterEach, describe, expect, it } from 'vitest'
import { FEEDBACK, feedbackMessage, openFeedback } from './feedback.mjs'
import { createRelay } from './relay.mjs'

const TELEGRAM = { token: '123:abc', chat: '42' }

/** Подставной Телеграм: запоминает запросы и отвечает как настоящий. */
function fakeTelegram(status = 200) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok: status < 300, status, json: async () => ({ ok: status < 300 }) }
  }
  return { calls, fetch }
}

let open = []
afterEach(() => {
  for (const f of open) f.close()
  open = []
})
function feedback(opts) {
  const f = openFeedback(':memory:', opts)
  open.push(f)
  return f
}

describe('feedback', () => {
  it('stores the text and sends it to the developer in Telegram', async () => {
    const tg = fakeTelegram()
    const f = feedback({ telegram: TELEGRAM, fetch: tg.fetch, now: () => 1000 })
    const res = f.submit(
      { text: 'Флеш не подсвечивается\nна тёрне', contact: '@vlad', meta: { version: '1.8.0', platform: 'macOS', where: 'Настройки', secret: 'ABC' } },
      '1.2.3.4',
    )
    expect(res).toEqual({ ok: true, id: 1 })
    await f.settle()

    expect(tg.calls).toHaveLength(1)
    const { url, body } = tg.calls[0]
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage')
    expect(body.chat_id).toBe('42')
    expect(body.parse_mode).toBeUndefined()
    expect(body.text).toContain('Флеш не подсвечивается\nна тёрне')
    expect(body.text).toContain('Контакт: @vlad')
    expect(body.text).toContain('Версия: 1.8.0 · Система: macOS · Откуда: Настройки')
    expect(body.text).not.toContain('ABC')

    const row = f.get(1)
    expect(row.contact).toBe('@vlad')
    expect(JSON.parse(row.meta)).toEqual({ version: '1.8.0', platform: 'macOS', where: 'Настройки' })
    expect(row.delivered).toBe(1000)
  })

  it('keeps feedback in the database when Telegram is not set up or fails', async () => {
    const tg = fakeTelegram()
    const quiet = feedback({ fetch: tg.fetch })
    expect(quiet.submit({ text: 'Без бота тоже работает' }, null).ok).toBe(true)
    await quiet.settle()
    expect(tg.calls).toHaveLength(0)
    expect(quiet.get(1).delivered).toBeNull()

    const down = fakeTelegram(502)
    const logs = []
    const broken = feedback({ telegram: TELEGRAM, fetch: down.fetch, log: (m) => logs.push(m) })
    expect(broken.submit({ text: 'Телеграм лежит' }, null).ok).toBe(true)
    await broken.settle()
    expect(broken.get(1).delivered).toBeNull()
    expect(logs.some((m) => m.includes('telegram failed'))).toBe(true)
  })

  it('resends what did not reach Telegram, once, and gives up on old feedback', async () => {
    let up = false
    const calls = []
    const fetch = async (url, init) => {
      calls.push(JSON.parse(init.body).text)
      return { ok: up, status: up ? 200 : 502, json: async () => ({}) }
    }
    let t = 0
    const f = feedback({ telegram: TELEGRAM, fetch, now: () => t })
    f.submit({ text: 'старый отзыв' }, null)
    t += FEEDBACK.retryForMs + 1
    f.submit({ text: 'свежий отзыв' }, null)
    await f.settle()
    expect(f.get(2).delivered).toBeNull()

    up = true
    calls.length = 0
    t += 3600_000
    f.retry()
    f.retry()
    await f.settle()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('свежий отзыв')
    expect(f.get(2).delivered).toBe(t)
    expect(f.get(1).delivered).toBeNull()

    f.retry()
    await f.settle()
    expect(calls).toHaveLength(1)
  })

  it('rejects empty text and limits how often one address writes', () => {
    let t = 0
    const f = feedback({ now: () => t })
    expect(() => f.submit({ text: '  ' }, 'a')).toThrow(/too short/)
    expect(() => f.submit({ text: 42 }, 'a')).toThrow(/too short/)
    for (let i = 0; i < FEEDBACK.perIp; i++) f.submit({ text: `отзыв ${i}` }, 'a')
    expect(() => f.submit({ text: 'ещё один' }, 'a')).toThrow(/slow down/)
    expect(f.submit({ text: 'с другого адреса' }, 'b').ok).toBe(true)
    t += FEEDBACK.ipWindowMs + 1
    expect(f.submit({ text: 'спустя время' }, 'a').ok).toBe(true)
  })

  it('caps messages per hour, the rest only goes to the database', async () => {
    const tg = fakeTelegram()
    const f = feedback({ telegram: TELEGRAM, fetch: tg.fetch })
    for (let i = 0; i < FEEDBACK.messagesPerHour + 3; i++) f.submit({ text: `отзыв номер ${i}` }, null)
    await f.settle()
    expect(tg.calls).toHaveLength(FEEDBACK.messagesPerHour)
  })

  it('formats the message without a contact and with an error', () => {
    const msg = feedbackMessage(7, 'Не подключается', null, { screen: 'Главный экран', error: 'Комнаты 123 456 нет' })
    expect(msg).toBe('Ривер, отзыв №7\n\nНе подключается\n\nКонтакт: не оставил\nЭкран: Главный экран\nОшибка: Комнаты 123 456 нет')
  })
})

describe('relay /api/feedback', () => {
  let relay
  afterEach(() => relay?.close())

  it('accepts feedback over HTTP', async () => {
    const tg = fakeTelegram()
    relay = await createRelay({ port: 0, host: '127.0.0.1', log: () => {}, feedback: { telegram: TELEGRAM, fetch: tg.fetch } })
    const post = (body) =>
      fetch(`http://127.0.0.1:${relay.port}/api/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    const ok = await post({ text: 'Всё отлично, но хочу омаху', meta: { screen: 'home' } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, id: 1 })
    await relay.feedback.settle()
    expect(tg.calls).toHaveLength(1)

    const bad = await post({ text: 'ой' })
    expect(bad.status).toBe(400)
  })
})
