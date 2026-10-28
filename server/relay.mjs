// Ретранслятор комнат Ривера. Игру считает хост у себя, сервер только пересылает
// кадры между ним и гостями внутри комнаты по коду. Содержимое сообщений не разбирает.
//
// Хост:  /ws?role=host&code=123456&secret=<hex>   ← {relay:'hosting'}, {t:'open'|'msg'|'close', conn, data?}
//                                                   → {t:'send', conn, data} | {t:'close', conn}
// Гость: /ws?role=guest&code=123456               ← {relay:'joined'}, дальше кадры хоста как есть
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

export const LIMITS = {
  rooms: 500,
  guestsPerRoom: 24,
  maxPayload: 128 * 1024,
  /** Сообщений в секунду на соединение (с запасом на всплески). */
  rate: 60,
  burst: 160,
  pingMs: 25_000,
}

const CLOSE = {
  notFound: 4404,
  taken: 4409,
  hostGone: 4410,
  full: 4413,
  badRequest: 4400,
  tooFast: 4429,
}

export function createRelay({ port = 8080, host = '0.0.0.0', log = console.log } = {}) {
  /** @type {Map<string, {secret: string, host: import('ws').WebSocket, guests: Map<number, import('ws').WebSocket>, nextId: number}>} */
  const rooms = new Map()

  const http = createServer((req, res) => {
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

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url.searchParams))
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

  function onConnection(ws, params) {
    const role = params.get('role')
    const code = params.get('code') ?? ''
    if (!/^\d{6}$/.test(code)) return ws.close(CLOSE.badRequest, 'bad code')
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
    ws.on('error', () => ws.terminate())
    if (role === 'host') return onHost(ws, code, params.get('secret') ?? '')
    if (role === 'guest') return onGuest(ws, code)
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

  function onGuest(ws, code) {
    const room = rooms.get(code)
    if (!room) return ws.close(CLOSE.notFound, 'no such room')
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
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
  }, LIMITS.pingMs)

  return new Promise((resolve) => {
    http.listen(port, host, () => {
      resolve({
        port: http.address().port,
        rooms,
        close: () =>
          new Promise((r) => {
            clearInterval(heartbeat)
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
  const relay = await createRelay({ port })
  console.log(`river relay on :${relay.port}`)
  const stop = async () => {
    await relay.close()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
