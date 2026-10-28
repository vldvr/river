import type { ClientMessage, ClientTransport, HostMessage } from '../../../protocol/index.ts'

export const DIRECT_PORT = 47474

/** «95.1.2.3», «95.1.2.3:5000», «[::1]:47474» → ws://… */
export function parseAddress(input: string): string | null {
  const s = input.trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '')
  if (!s) return null
  const m = s.match(/^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/)
  if (!m) return null
  const port = m[2] ? Number(m[2]) : DIRECT_PORT
  if (port < 1 || port > 65535) return null
  return `ws://${m[1]}:${port}`
}

export function connectByAddress(url: string, timeoutMs = 8000): Promise<ClientTransport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let open = false
    const timer = setTimeout(() => {
      if (!open) {
        ws.close()
        reject(new Error('timeout'))
      }
    }, timeoutMs)
    const t: ClientTransport = {
      onMessage: null,
      onClose: null,
      send(msg: ClientMessage) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
      },
      close() {
        ws.close()
      },
    }
    ws.onopen = () => {
      open = true
      clearTimeout(timer)
      resolve(t)
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      try {
        t.onMessage?.(JSON.parse(ev.data) as HostMessage)
      } catch {
        // мусор от чужого сервера игнорируем
      }
    }
    ws.onerror = () => {
      if (!open) {
        clearTimeout(timer)
        reject(new Error('unreachable'))
      }
    }
    ws.onclose = () => {
      if (open) t.onClose?.()
    }
  })
}
