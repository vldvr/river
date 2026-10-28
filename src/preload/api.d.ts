export type DirectEvent =
  | { type: 'open'; conn: number; address: string }
  | { type: 'message'; conn: number; data: string }
  | { type: 'close'; conn: number }

export interface NetAddress {
  name: string
  address: string
  kind: 'lan' | 'radmin' | 'zerotier' | 'tailscale' | 'hamachi' | 'other'
}

export type UpdateState =
  | { state: 'idle' }
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string }
  | { state: 'available'; version: string; url: string }
  | { state: 'error'; message: string }

/** То, что preload отдаёт окну как window.river. */
export interface RiverApi {
  info(): Promise<{ version: string; platform: string; portable: boolean }>
  flash(on: boolean): void
  toggleFullscreen(): void
  keepAwake(on: boolean): void
  openExternal(url: string): void
  direct: {
    start(port: number): Promise<{ ok: true; port: number } | { ok: false; error: string }>
    stop(): Promise<void>
    send(conn: number, data: string): void
    close(conn: number): void
    onEvent(cb: (e: DirectEvent) => void): () => void
  }
  upnp: {
    map(port: number): Promise<{ ok: true; externalIp: string } | { ok: false; error: string }>
    unmap(): Promise<void>
  }
  net: {
    interfaces(): Promise<NetAddress[]>
  }
  update: {
    onState(cb: (s: UpdateState) => void): () => void
    install(): void
  }
}

declare global {
  interface Window {
    river?: RiverApi
  }
}
