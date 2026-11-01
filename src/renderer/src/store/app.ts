import { create } from 'zustand'
import type { CardBack, TableView } from '../../../protocol/index.ts'
import type { UpdateState } from '../../../preload/api'
import { load, save } from '../lib/storage'
import { newRecoveryCode, randomToken } from '../lib/id'

export const PLAYER_COLORS = ['#e0a458', '#d0705a', '#c98bb9', '#8f9ee0', '#5fb3c9', '#6fbf8b', '#b8c46a', '#a59d90']

export interface ProfileState {
  name: string
  color: string
  avatar: string | null
  token: string
  /** Код восстановления: по нему сервер узнаёт игрока и хранит его рейтинг. */
  secret: string
  /** Рубашка, которую видят все за столом. */
  back: CardBack
  /** Старый локальный рейтинг уже перенесён на сервер. */
  migrated: boolean
  /** Последний известный рейтинг с сервера, для показа без сети. */
  rating: number
  ratingGames: number
}

export type Felt = 'green' | 'blue' | 'wine' | 'graphite' | 'sea'
export type Accent = 'amber' | 'ice' | 'rose'
export type Speed = 'normal' | 'fast'

export interface Settings {
  volume: number
  muted: boolean
  speed: Speed
  fourColor: boolean
  felt: Felt
  accent: Accent
  reduceMotion: boolean
  turnSound: boolean
}

export type ConnState = 'idle' | 'connecting' | 'online' | 'reconnecting'

export interface ChatLine {
  id: number
  from: string | null
  name: string
  text: string
  ts: number
}

export interface LogLine {
  id: number
  hand: number
  text: string
  strong?: boolean
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

interface AppState {
  profile: ProfileState
  settings: Settings
  screen: 'home' | 'game'
  role: 'host' | 'guest' | null
  code: string | null
  conn: ConnState
  /** Связь хоста с сервером комнат. */
  relay: 'connecting' | 'online' | 'offline'
  homeError: string | null
  you: string | null
  view: TableView | null
  /** Состояние, которое уже показано на столе (отстаёт от view, пока идут анимации). */
  shown: TableView | null
  avatars: Record<string, string>
  chat: ChatLine[]
  unread: number
  log: LogLine[]
  /** Растёт, когда хост отклонил действие: панель действий снова показывается. */
  rejected: number
  /** Последняя реакция каждого игрока: фраза над местом. */
  reactions: Record<string, { r: number; at: number }>
  toasts: Toast[]
  update: UpdateState
  appVersion: string
  setProfile(p: Partial<ProfileState>): void
  setSettings(s: Partial<Settings>): void
  toast(text: string, tone?: Toast['tone']): void
  dismissToast(id: number): void
  pushLog(hand: number, text: string, strong?: boolean): void
}

const defaultProfile: ProfileState = {
  name: '',
  color: PLAYER_COLORS[0]!,
  avatar: null,
  token: '',
  secret: '',
  back: 'classic',
  migrated: false,
  rating: 1000,
  ratingGames: 0,
}

const defaultSettings: Settings = {
  volume: 0.7,
  muted: false,
  speed: 'normal',
  fourColor: false,
  felt: 'green',
  accent: 'amber',
  reduceMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  turnSound: true,
}

function initialProfile(): ProfileState {
  const p = load('profile', defaultProfile)
  if (!p.token || !p.secret) {
    p.token ||= randomToken()
    p.secret ||= newRecoveryCode()
    save('profile', p)
  }
  return p
}

let toastSeq = 0
let logSeq = 0

export const useApp = create<AppState>((set, get) => ({
  profile: initialProfile(),
  settings: load('settings', defaultSettings),
  screen: 'home',
  role: null,
  code: null,
  conn: 'idle',
  relay: 'connecting',
  homeError: null,
  you: null,
  view: null,
  shown: null,
  avatars: {},
  chat: [],
  unread: 0,
  log: [],
  rejected: 0,
  reactions: {},
  toasts: [],
  update: { state: 'idle' },
  appVersion: '0.0.0',
  setProfile(p) {
    const profile = { ...get().profile, ...p }
    save('profile', profile)
    set({ profile })
  },
  setSettings(s) {
    const settings = { ...get().settings, ...s }
    save('settings', settings)
    set({ settings })
  },
  toast(text, tone = 'info') {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, text, tone }].slice(-3) })
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 3600)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  pushLog(hand, text, strong) {
    set({ log: [...get().log, { id: ++logSeq, hand, text, strong }].slice(-400) })
  },
}))
