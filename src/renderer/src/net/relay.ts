import type { ClientMessage, ClientTransport, HostMessage } from '../../../protocol/index.ts'
import type { HostServer, Session } from '../../../host/index.ts'

/** Сервер комнат на russia. Для разработки: ?relay=ws://127.0.0.1:8787/ws или localStorage river.relay. */
export const RELAY_URL = (() => {
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('relay')
    if (q) return q
    try {
      const saved = localStorage.getItem('river.relay')
      if (saved) return saved
    } catch {
      // нет хранилища: берём боевой адрес
    }
  }
  return 'wss://river.wkiseven.me/ws'
})()

const CLOSE_NOT_FOUND = 4404
const CLOSE_TAKEN = 4409
const CLOSE_FULL = 4413

export class NotFoundError extends Error {}
export class RoomFullError extends Error {}
export class ServerUnreachableError extends Error {}
export class CodeTakenError extends Error {}

export type RelayStatus = 'connecting' | 'online' | 'offline'

/**
 * Хост держит одно соединение с сервером: тот сообщает о новых гостях и пересылает их кадры.
 * Если связь пропала, хост переподключается с тем же кодом, гости возвращаются сами.
 */
export class HostRelay {
  private ws: WebSocket | null = null
  private sessions = new Map<number, Session>()
  private closed = false
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  status: RelayStatus = 'connecting'

  constructor(
    private code: string,
    /** Случайный секрет комнаты: только у хоста и в его сохранении. */
    private secret: string,
    private server: HostServer,
    private onStatus: (s: RelayStatus, error?: Error) => void,
  ) {
    void this.connect()
  }

  private async connect() {
    if (this.closed) return
    const ws = new WebSocket(`${RELAY_URL}?role=host&code=${this.code}&secret=${this.secret}`)
    this.ws = ws
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: { relay?: string; t?: string; conn?: number; data?: string }
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.relay === 'hosting') {
        this.retry = 0
        this.setStatus('online')
        return
      }
      const conn = msg.conn
      if (typeof conn !== 'number') return
      if (msg.t === 'open') {
        this.sessions.set(
          conn,
          this.server.attach({
            send: (m: HostMessage) => this.send({ t: 'send', conn, data: JSON.stringify(m) }),
            close: () => this.send({ t: 'close', conn }),
          }),
        )
      } else if (msg.t === 'msg' && typeof msg.data === 'string') {
        let data: unknown
        try {
          data = JSON.parse(msg.data)
        } catch {
          return
        }
        this.sessions.get(conn)?.receive(data)
      } else if (msg.t === 'close') {
        this.sessions.get(conn)?.detach()
        this.sessions.delete(conn)
      }
    }
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      for (const s of this.sessions.values()) s.detach()
      this.sessions.clear()
      if (this.closed) return
      if (ev.code === CLOSE_TAKEN) {
        this.closed = true
        this.setStatus('offline', new CodeTakenError('code taken'))
        return
      }
      this.setStatus('offline')
      const delay = Math.min(15_000, 1000 * 2 ** this.retry++)
      this.timer = setTimeout(() => void this.connect(), delay)
    }
  }

  private send(obj: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  private setStatus(s: RelayStatus, error?: Error) {
    this.status = s
    this.onStatus(s, error)
  }

  close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    for (const s of this.sessions.values()) s.detach()
    this.sessions.clear()
    this.ws?.close(1000)
    this.ws = null
  }
}

/** Гость: входит в комнату по коду через сервер. */
export function connectByCode(code: string, timeoutMs = 12_000): Promise<ClientTransport> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(`${RELAY_URL}?role=guest&code=${code}`)
    } catch {
      reject(new ServerUnreachableError('bad url'))
      return
    }
    let joined = false
    const timer = setTimeout(() => {
      if (joined) return
      ws.close()
      reject(new ServerUnreachableError('timeout'))
    }, timeoutMs)

    const t: ClientTransport = {
      onMessage: null,
      onClose: null,
      send(msg: ClientMessage) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
      },
      close() {
        ws.close(1000)
      },
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: (HostMessage & { relay?: undefined }) | { relay: string }
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if ('relay' in msg && msg.relay) {
        if (msg.relay === 'joined' && !joined) {
          joined = true
          clearTimeout(timer)
          resolve(t)
        }
        return
      }
      t.onMessage?.(msg as HostMessage)
    }
    ws.onclose = (ev) => {
      if (joined) {
        t.onClose?.()
        return
      }
      clearTimeout(timer)
      if (ev.code === CLOSE_NOT_FOUND) reject(new NotFoundError('not found'))
      else if (ev.code === CLOSE_FULL) reject(new RoomFullError('full'))
      else reject(new ServerUnreachableError(`closed ${ev.code}`))
    }
  })
}
