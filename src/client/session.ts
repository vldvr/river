import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ClientTransport,
  type HelloMessage,
  type HostMessage,
  type RejectReason,
  type TableView,
  type ViewEvent,
} from '../protocol/index.ts'

export interface SessionHandlers {
  onWelcome(you: string, view: TableView, avatars: Record<string, string>): void
  onView(view: TableView): void
  onEvents(seq: number, events: ViewEvent[], view: TableView): void
  onAvatar(id: string, avatar: string | null): void
  onChat(msg: { from: string; name: string; text: string; ts: number }): void
  onReact(from: string, r: number): void
  onReject(reason: RejectReason, hostVersion?: string): void
  onError(message: string): void
  /** Транспорт закрылся не по нашей воле. */
  onDrop(): void
}

export type Profile = Omit<HelloMessage, 't' | 'v'>

const PING_MS = 3000

/** Протокол клиента поверх любого транспорта. Переподключение решает вызывающий. */
export class GameSession {
  private transport: ClientTransport | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private rtt: number | null = null
  private closing = false

  constructor(
    private profile: Profile,
    private h: SessionHandlers,
  ) {}

  attach(t: ClientTransport) {
    this.detach()
    this.closing = false
    this.transport = t
    t.onMessage = (msg) => this.receive(msg)
    t.onClose = () => {
      if (this.transport !== t) return
      this.stopPing()
      this.transport = null
      if (!this.closing) this.h.onDrop()
    }
    t.send({ t: 'hello', v: PROTOCOL_VERSION, ...this.profile })
    this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now(), rtt: this.rtt }), PING_MS)
  }

  /** Новое имя, цвет, картинка или рубашка: хост покажет их всем сразу. */
  updateProfile(p: Pick<Profile, 'name' | 'color' | 'avatar' | 'back'>) {
    this.profile = { ...this.profile, ...p }
    this.send({ t: 'profile', name: p.name, color: p.color, avatar: p.avatar, back: p.back })
  }

    get connected() {
    return this.transport !== null
  }

  get latency() {
    return this.rtt
  }

  send(msg: ClientMessage) {
    this.transport?.send(msg)
  }

  /** Сознательно закрываем: без onDrop. */
  close() {
    this.closing = true
    this.detach()
  }

  private detach() {
    this.stopPing()
    const t = this.transport
    this.transport = null
    if (t) {
      t.onClose = null
      t.onMessage = null
      t.close()
    }
  }

  private stopPing() {
    if (this.pingTimer !== null) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private receive(msg: HostMessage) {
    switch (msg.t) {
      case 'welcome':
        return this.h.onWelcome(msg.you, msg.view, msg.avatars)
      case 'view':
        return this.h.onView(msg.view)
      case 'events':
        return this.h.onEvents(msg.seq, msg.events, msg.view)
      case 'avatar':
        return this.h.onAvatar(msg.id, msg.avatar)
      case 'chat':
        return this.h.onChat(msg)
      case 'react':
        return this.h.onReact(msg.from, msg.r)
      case 'reject':
        this.closing = true
        return this.h.onReject(msg.reason, msg.hostVersion)
      case 'error':
        return this.h.onError(msg.message)
      case 'pong':
        this.rtt = Math.max(0, Date.now() - msg.ts)
        return
    }
  }
}
