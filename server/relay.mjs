// Ретранслятор комнат Ривера. Игру считает хост у себя, сервер только пересылает
// кадры между ним и гостями внутри комнаты по коду. Содержимое сообщений не разбирает.
//
// Хост:  /ws?role=host&code=123456&secret=<hex>   ← {relay:'hosting'}, {t:'open'|'msg'|'close', conn, data?}
//                                                   → {t:'send', conn, data} | {t:'close', conn}
// Гость: /ws?role=guest&code=123456               ← {relay:'joined'}, дальше кадры хоста как есть
//
// Плюс рейтинг игроков: /api/*, см. accounts.mjs.
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { ApiError, openAccounts } from './accounts.mjs'

export const LIMITS = {
  rooms: 500,
  guestsPerRoom: 24,
  maxPayload: 128 * 1024,
  /** Сообщений в секунду на соединение (с запасом на всплески). */
  rate: 60,
  burst: 160,
  pingMs: 25_000,
  /** Сколько промахов мимо комнат за окно допускаем с одного адреса. */
  missesPerWindow: 12,
  missWindowMs: 60_000,
  missBlockMs: 60_000,
  /** Запросов к /api за минуту с одного адреса. */
  apiPerMinute: 60,
  apiBody: 16 * 1024,
}

const CLOSE = {
  notFound: 4404,
  taken: 4409,
  hostGone: 4410,
  full: 4413,
  badRequest: 4400,
  tooFast: 4429,
}

export function createRelay({ port = 8080, host = '0.0.0.0', log = console.log, trustProxy = false, db = ':memory:', now } = {}) {
  /** @type {Map<string, {secret: string, host: import('ws').WebSocket, guests: Map<number, import('ws').WebSocket>, nextId: number}>} */
  const rooms = new Map()
  const accounts = openAccounts(db, now ? { now } : undefined)
  const ownsRoom = (code, secret) => typeof secret === 'string' && rooms.get(code)?.secret === secret
  const apiHits = new Map()

  async function api(req, res, route) {
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'access-control-allow-methods': 'POST' })
      return res.end()
    }
    const reply = (status, body) => {
      res.writeHead(status, headers)
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return reply(405, { error: 'POST only' })
    // Код восстановления не перебрать: запросов с адреса за минуту немного.
    const ip = ipOf(req)
    if (ip) {
      const t = Date.now()
      const h = apiHits.get(ip) ?? { count: 0, since: t }
      if (t - h.since > 60_000) Object.assign(h, { count: 0, since: t })
      h.count += 1
      apiHits.set(ip, h)
      if (h.count > LIMITS.apiPerMinute) return reply(429, { error: 'slow down' })
    }
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > LIMITS.apiBody) return reply(413, { error: 'too big' })
    }
    let body
    try {
      body = JSON.parse(raw)
      if (!body || typeof body !== 'object') throw new Error()
    } catch {
      return reply(400, { error: 'bad json' })
    }
    try {
      if (route === 'me') return reply(200, accounts.me(body))
      if (route === 'ticket') return reply(200, accounts.ticket(body))
      if (route === 'seat') return reply(200, accounts.seat(body))
      if (route === 'game') return reply(200, accounts.report(body, ownsRoom))
      return reply(404, { error: 'not found' })
    } catch (err) {
      if (err instanceof ApiError) return reply(err.status, { error: err.message })
      log(`api ${route} failed: ${err?.stack ?? err}`)
      return reply(500, { error: 'server error' })
    }
  }

  const http = createServer((req, res) => {
    const m = /^\/api\/([a-z]+)$/.exec(req.url ?? '')
    if (m) {
      api(req, res, m[1]).catch(() => res.destroy())
      return
    }
    if (req.url === '/health') {
      let guests = 0
      for (const r of rooms.values()) guests += r.guests.size
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, guests }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Ривер: сервер комнат. Скачать игру: https://github.com/vldvr/river/releases\n')
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxPayload, perMessageDeflate: false })

  // Перебор кодов: после серии промахов адрес на минуту получает отказ.
  const misses = new Map()
  // За nginx (порт контейнера открыт только на localhost) адрес клиента приходит в X-Real-IP;
  // без прокси берём адрес сокета. Неизвестный адрес не блокируем, чтобы не задеть всех сразу.
  const ipOf = (req) => {
    if (trustProxy) {
      const fwd = req.headers['x-real-ip']
      return typeof fwd === 'string' && fwd ? fwd : null
    }
    return req.socket.remoteAddress ?? null
  }
  const blocked = (ip) => {
    if (!ip) return false
    const m = misses.get(ip)
    return !!m && m.until > Date.now()
  }
  const miss = (ip) => {
    if (!ip) return
    const now = Date.now()
    const m = misses.get(ip) ?? { count: 0, since: now, until: 0 }
    if (now - m.since > LIMITS.missWindowMs) {
      m.count = 0
      m.since = now
    }
    m.count += 1
    if (m.count >= LIMITS.missesPerWindow) m.until = now + LIMITS.missBlockMs
    misses.set(ip, m)
  }

  http.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://x')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    const ip = ipOf(req)
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url.searchParams, ip))
  })

  function limiter(ws) {
    let tokens = LIMITS.burst
    let last = Date.now()
    return () => {
      const now = Date.now()
      tokens = Math.min(LIMITS.burst, tokens + ((now - last) / 1000) * LIMITS.rate)
      last = now
      if (tokens < 1) {
        ws.close(CLOSE.tooFast, 'too fast')
        return false
      }
      tokens -= 1
      return true
    }
  }

  function onConnection(ws, params, ip) {
    const role = params.get('role')
    const code = params.get('code') ?? ''
    if (!/^\d{6}$/.test(code)) return ws.close(CLOSE.badRequest, 'bad code')
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
    ws.on('error', () => ws.terminate())
    if (role === 'host') return onHost(ws, code, params.get('secret') ?? '')
    if (role === 'guest') return onGuest(ws, code, ip)
    ws.close(CLOSE.badRequest, 'bad role')
  }

  function onHost(ws, code, secret) {
    if (!/^[0-9a-f]{32,128}$/.test(secret)) return ws.close(CLOSE.badRequest, 'bad secret')
    let room = rooms.get(code)
    if (room && room.secret !== secret) return ws.close(CLOSE.taken, 'code taken')
    if (!room && rooms.size >= LIMITS.rooms) return ws.close(CLOSE.full, 'server full')
    if (room) {
      // Тот же хост переподключился: старое соединение и его гостей закрываем.
      dropRoom(code, room, 'host replaced')
    }
    room = { secret, host: ws, guests: new Map(), nextId: 1 }
    rooms.set(code, room)
    log(`room ${code} open (${rooms.size} rooms)`)
    ws.send(JSON.stringify({ relay: 'hosting', code }))

    const allow = limiter(ws)
    ws.on('message', (raw, isBinary) => {
      if (isBinary || !allow()) return
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      const guest = room.guests.get(msg?.conn)
      if (!guest) return
      if (msg.t === 'send' && typeof msg.data === 'string') guest.send(msg.data)
      else if (msg.t === 'close') guest.close(1000, 'closed by host')
    })
    ws.on('close', () => {
      if (rooms.get(code) === room) dropRoom(code, room, 'host left')
    })
  }

  function onGuest(ws, code, ip) {
    if (blocked(ip)) return ws.close(CLOSE.tooFast, 'slow down')
    const room = rooms.get(code)
    if (!room) {
      miss(ip)
      return ws.close(CLOSE.notFound, 'no such room')
    }
    if (room.guests.size >= LIMITS.guestsPerRoom) return ws.close(CLOSE.full, 'room full')
    const conn = room.nextId++
    room.guests.set(conn, ws)
    const toHost = (obj) => {
      if (room.host.readyState === room.host.OPEN) room.host.send(JSON.stringify(obj))
    }
    toHost({ t: 'open', conn })
    ws.send(JSON.stringify({ relay: 'joined' }))

    const allow = limiter(ws)
    ws.on('message', (raw, isBinary) => {
      if (isBinary || !allow()) return
      toHost({ t: 'msg', conn, data: raw.toString() })
    })
    ws.on('close', () => {
      if (room.guests.get(conn) === ws) {
        room.guests.delete(conn)
        toHost({ t: 'close', conn })
      }
    })
  }

  function dropRoom(code, room, reason) {
    rooms.delete(code)
    for (const g of room.guests.values()) g.close(CLOSE.hostGone, 'host gone')
    room.guests.clear()
    if (room.host.readyState === room.host.OPEN) room.host.close(CLOSE.hostGone, reason)
    log(`room ${code} closed: ${reason} (${rooms.size} rooms)`)
  }

  // Живые ли соединения: без ответа на ping за интервал рвём.
  const heartbeat = setInterval(() => {
    const now = Date.now()
    for (const [ip, m] of misses) if (m.until < now && now - m.since > LIMITS.missWindowMs) misses.delete(ip)
    for (const [ip, h] of apiHits) if (now - h.since > 60_000) apiHits.delete(ip)
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
  }, LIMITS.pingMs)
  const settler = setInterval(() => {
    try {
      accounts.settleStale()
    } catch (err) {
      log(`settle failed: ${err}`)
    }
  }, 60_000)

  return new Promise((resolve) => {
    http.listen(port, host, () => {
      resolve({
        port: http.address().port,
        rooms,
        accounts,
        close: () =>
          new Promise((r) => {
            clearInterval(heartbeat)
            clearInterval(settler)
            accounts.close()
            for (const ws of wss.clients) ws.terminate()
            wss.close()
            http.close(() => r())
          }),
      })
    })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8080)
  const relay = await createRelay({ port, trustProxy: process.env.TRUST_PROXY === '1', db: process.env.DB_FILE ?? 'river.db' })
  console.log(`river relay on :${relay.port}`)
  const stop = async () => {
    await relay.close()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
