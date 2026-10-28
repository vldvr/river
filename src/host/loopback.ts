import type { ClientMessage, ClientTransport, HostMessage } from '../protocol/index.ts'
import type { HostServer } from './server.ts'

export type Deliver = (fn: () => void) => void

/**
 * Клиент хоста внутри того же окна. Сообщения доставляются асинхронно и
 * клонируются, как если бы шли по сети.
 */
export function loopback(server: HostServer, deliver: Deliver = queueMicrotask): ClientTransport {
  let closed = false
  const t: ClientTransport = {
    onMessage: null,
    onClose: null,
    send(msg: ClientMessage) {
      if (closed) return
      const copy = structuredClone(msg)
      deliver(() => session.receive(copy))
    },
    close() {
      if (closed) return
      closed = true
      deliver(() => session.detach())
    },
  }
  const session = server.attach({
    send(msg: HostMessage) {
      if (closed) return
      const copy = structuredClone(msg)
      deliver(() => t.onMessage?.(copy))
    },
    close() {
      if (closed) return
      closed = true
      deliver(() => t.onClose?.())
    },
  })
  return t
}
