import type { ClientMessage, HostMessage } from './messages.ts'

/** Канал клиента до хоста: WebRTC, WebSocket или петля внутри окна хоста. */
export interface ClientTransport {
  send(msg: ClientMessage): void
  close(): void
  onMessage: ((msg: HostMessage) => void) | null
  onClose: (() => void) | null
}
