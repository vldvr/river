import { HostServer, loopback, type HostSnapshot, type Session } from '../../../host/index.ts'
import type { GameConfig } from '../../../engine/index.ts'
import type { ClientTransport, HostMessage } from '../../../protocol/index.ts'
import type { NetAddress } from '../../../preload/api'
import { native } from '../lib/native'
import { save } from '../lib/storage'
import { HostRelay, type RelayStatus } from './relay'
import { DIRECT_PORT } from './ws'

export interface DirectInfo {
  port: number
  addresses: NetAddress[]
  externalIp: string | null
  upnpError: string | null
}

const SNAPSHOT_KEY = 'snapshot'

/** Сохранение хоста: состояние партии и секрет комнаты на сервере. */
export type SavedGame = HostSnapshot & { relaySecret: string }

/** Всё, что крутится у хоста: сервер партии, комната для гостей и вход по IP. */
export class HostRuntime {
  readonly server: HostServer
  private relay: HostRelay
  private directSessions = new Map<number, Session>()
  private offDirect: (() => void) | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pending: SavedGame | null = null
  private readonly relaySecret: string

  constructor(opts: {
    code: string
    hostToken: string
    relaySecret: string
    appVersion: string
    config?: GameConfig
    restore?: HostSnapshot
    onRelay: (s: RelayStatus, error?: Error) => void
  }) {
    this.relaySecret = opts.relaySecret
    this.server = new HostServer({
      code: opts.code,
      hostToken: opts.hostToken,
      appVersion: opts.appVersion,
      config: opts.config,
      restore: opts.restore,
      onSnapshot: (s) => this.queueSave(s),
    })
    this.relay = new HostRelay(opts.code, opts.relaySecret, this.server, opts.onRelay)
    native?.keepAwake(true)
  }

  ownTransport(): ClientTransport {
    return loopback(this.server)
  }

  private queueSave(s: HostSnapshot) {
    this.pending = { ...s, relaySecret: this.relaySecret }
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      if (this.pending) save(SNAPSHOT_KEY, this.pending)
      this.pending = null
    }, 400)
  }

  async enableDirect(): Promise<DirectInfo | { error: string }> {
    if (!native) return { error: 'no-native' }
    const started = await native.direct.start(DIRECT_PORT)
    if (!started.ok) return { error: started.error }
    if (!this.offDirect) {
      this.offDirect = native.direct.onEvent((e) => {
        if (e.type === 'open') {
          const conn = e.conn
          this.directSessions.set(
            conn,
            this.server.attach({
              send: (msg: HostMessage) => native!.direct.send(conn, JSON.stringify(msg)),
              close: () => native!.direct.close(conn),
            }),
          )
        } else if (e.type === 'message') {
          let data: unknown
          try {
            data = JSON.parse(e.data)
          } catch {
            return
          }
          this.directSessions.get(e.conn)?.receive(data)
        } else {
          this.directSessions.get(e.conn)?.detach()
          this.directSessions.delete(e.conn)
        }
      })
    }
    const [addresses, upnp] = await Promise.all([native.net.interfaces(), native.upnp.map(started.port)])
    return {
      port: started.port,
      addresses,
      externalIp: upnp.ok ? upnp.externalIp : null,
      upnpError: upnp.ok ? null : upnp.error,
    }
  }

  async disableDirect() {
    this.offDirect?.()
    this.offDirect = null
    for (const s of this.directSessions.values()) s.detach()
    this.directSessions.clear()
    await native?.direct.stop()
  }

  /** Игра закончена по воле хоста: снапшот больше не нужен. */
  dispose(keepSnapshot = false) {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (!keepSnapshot) this.server.finishGame()
    if (!keepSnapshot) save(SNAPSHOT_KEY, null)
    this.relay.close()
    void this.disableDirect()
    this.server.dispose()
    native?.keepAwake(false)
  }
}
