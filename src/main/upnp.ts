import { upnpNat, type Gateway } from '@achingbrain/nat-port-mapper'
import { listInterfaces } from './netinfo'

let gateway: Gateway | null = null
let mapped: number | null = null

/** Пробует открыть порт на роутере. Возвращает внешний адрес, если получилось. */
export async function mapPort(port: number): Promise<{ ok: true; externalIp: string } | { ok: false; error: string }> {
  try {
    const lan = listInterfaces().find((i) => i.kind === 'lan')
    if (!lan) return { ok: false, error: 'no-lan' }
    const client = upnpNat({ description: 'River poker', ttl: 7200, autoRefresh: true })
    for await (const gw of client.findGateways({ signal: AbortSignal.timeout(6000) })) {
      await gw.map(port, lan.address, { protocol: 'tcp', externalPort: port, signal: AbortSignal.timeout(6000) })
      const externalIp = await gw.externalIp({ signal: AbortSignal.timeout(4000) })
      gateway = gw
      mapped = port
      return { ok: true, externalIp }
    }
    return { ok: false, error: 'no-gateway' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function unmapPort() {
  const gw = gateway
  const port = mapped
  gateway = null
  mapped = null
  if (!gw || port === null) return
  try {
    await gw.unmap(port, { signal: AbortSignal.timeout(3000) })
    await gw.stop()
  } catch {
    // роутер мог уже забыть: не важно
  }
}
