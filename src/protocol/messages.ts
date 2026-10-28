import { z } from 'zod'
import type { TableView, ViewEvent } from './view.ts'

export const PROTOCOL_VERSION = 1
export const APP_ID = `river-holdem-v${PROTOCOL_VERSION}`

/** Аватар: webp/png/jpeg data-URL, до ~48 КБ. */
const avatarSchema = z
  .string()
  .max(65_000)
  .regex(/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/)

const playerAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }),
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('call') }),
  z.object({ type: z.literal('allin') }),
  z.object({ type: z.literal('raise'), to: z.number().int().positive().max(1e12) }),
])

export const configSchema = z.object({
  format: z.enum(['tournament', 'cash']),
  startingStack: z.number().int().min(20).max(10_000_000),
  smallBlind: z.number().int().min(1).max(1_000_000),
  bigBlind: z.number().int().min(2).max(2_000_000),
  antes: z.boolean(),
  levelMinutes: z.number().int().min(0).max(120),
  allowRebuy: z.boolean(),
  turnSeconds: z.number().int().min(5).max(300),
  maxSeats: z.number().int().min(2).max(9),
})

export const clientMessage = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.number().int(),
    appVersion: z.string().max(40),
    name: z.string().trim().min(1).max(20),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    avatar: avatarSchema.nullable(),
    token: z.string().min(16).max(64),
  }),
  z.object({ t: z.literal('action'), handNo: z.number().int(), action: playerAction }),
  z.object({ t: z.literal('chat'), text: z.string().trim().min(1).max(200) }),
  z.object({ t: z.literal('sit'), out: z.boolean() }),
  z.object({ t: z.literal('rebuy') }),
  z.object({ t: z.literal('show') }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('ping'), ts: z.number(), rtt: z.number().min(0).max(60_000).nullable() }),
  // Только хост:
  z.object({ t: z.literal('config'), config: configSchema }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('addBot') }),
  z.object({ t: z.literal('kick'), id: z.string().max(64) }),
  z.object({ t: z.literal('pause'), paused: z.boolean() }),
  z.object({ t: z.literal('again') }),
])

export type ClientMessage = z.infer<typeof clientMessage>
export type HelloMessage = Extract<ClientMessage, { t: 'hello' }>

export type RejectReason = 'version' | 'full' | 'kicked' | 'closed'

export type HostMessage =
  | { t: 'welcome'; you: string; view: TableView; avatars: Record<string, string> }
  | { t: 'reject'; reason: RejectReason; hostVersion?: string }
  | { t: 'view'; view: TableView }
  | { t: 'events'; seq: number; events: ViewEvent[]; view: TableView }
  | { t: 'avatar'; id: string; avatar: string | null }
  | { t: 'chat'; from: string; name: string; text: string; ts: number }
  | { t: 'error'; message: string }
  | { t: 'pong'; ts: number }

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const r = clientMessage.safeParse(raw)
  return r.success ? r.data : null
}
