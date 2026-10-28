import { networkInterfaces } from 'node:os'
import type { NetAddress } from '../preload/api'

function kindOf(name: string, ip: string): NetAddress['kind'] {
  const [a = 0, b = 0] = ip.split('.').map(Number)
  if (/zerotier|^zt/i.test(name)) return 'zerotier'
  if (/tailscale/i.test(name) || (a === 100 && b >= 64 && b <= 127)) return 'tailscale'
  if (/radmin/i.test(name) || a === 26) return 'radmin'
  if (/hamachi/i.test(name) || a === 25) return 'hamachi'
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 'lan'
  return 'other'
}

export function listInterfaces(): NetAddress[] {
  const out: NetAddress[] = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue
      out.push({ name, address: a.address, kind: kindOf(name, a.address) })
    }
  }
  const order: NetAddress['kind'][] = ['lan', 'radmin', 'zerotier', 'tailscale', 'hamachi', 'other']
  return out.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind))
}
