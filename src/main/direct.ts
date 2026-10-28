import { WebSocketServer, type WebSocket } from 'ws'
import type { DirectEvent } from '../preload/api'

const MAX_CONNECTIONS = 32
const MAX_PAYLOAD = 128 * 1024

/** WebSocket-сервер для входа по IP. Кадры уходят в окно хоста как есть. */
export class DirectServer {
  private wss: WebSocketServer | null = null
  private conns = new Map<number, WebSocket>()
  private nextId = 1

  constructor(private emit: (e: DirectEvent) => void) {}

  get port(): number | null {
    const addr = this.wss?.address()
    return addr && typeof addr === 'object' ? addr.port : null
  }

  start(port: number): Promise<{ ok: true; port: number } | { ok: false; error: string }> {
    if (this.wss && this.port !== null) return Promise.resolve({ ok: true, port: this.port })
    return new Promise((resolve) => {
      const wss = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: MAX_PAYLOAD, perMessageDeflate: false })
      wss.once('listening', () => {
        this.wss = wss
        resolve({ ok: true, port: this.port ?? port })
      })
      wss.once('error', (err: NodeJS.ErrnoException) => {
        wss.close()
        resolve({ ok: false, error: err.code === 'EADDRINUSE' ? 'busy' : err.message })
      })
      wss.on('connection', (ws, req) => {
        if (this.conns.size >= MAX_CONNECTIONS) {
          ws.close(1013, 'full')
          return
        }
        const id = this.nextId++
        this.conns.set(id, ws)
        this.emit({ type: 'open', conn: id, address: req.socket.remoteAddress ?? '' })
        ws.on('message', (data, isBinary) => {
          if (isBinary) return
          this.emit({ type: 'message', conn: id, data: data.toString() })
        })
        ws.on('close', () => {
          this.conns.delete(id)
          this.emit({ type: 'close', conn: id })
        })
        ws.on('error', () => ws.terminate())
      })
    })
  }

  send(conn: number, data: string) {
    const ws = this.conns.get(conn)
    if (ws && ws.readyState === ws.OPEN) ws.send(data)
  }

  close(conn: number) {
    this.conns.get(conn)?.close()
  }

  stop() {
    for (const ws of this.conns.values()) ws.terminate()
    this.conns.clear()
    this.wss?.close()
    this.wss = null
  }
}
