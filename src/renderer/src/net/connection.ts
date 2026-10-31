import { GameSession, type Profile, type SessionHandlers } from '../../../client/session.ts'
import { DEFAULT_CONFIG, type GameConfig } from '../../../engine/index.ts'
import type { ClientMessage, RejectReason } from '../../../protocol/index.ts'
import { enqueue, resetScene, viewUpdate } from '../choreo/choreographer'
import { sound } from '../audio/sound'
import { formatCode } from '../lib/format'
import { randomHex, randomRoomCode, roomToken } from '../lib/id'
import { native } from '../lib/native'
import { loadRaw, save } from '../lib/storage'
import { useApp } from '../store/app'
import { useScene } from '../store/scene'
import { HostRuntime, type DirectInfo, type SavedGame } from './host'
import { CodeTakenError, connectByCode, NotFoundError, RoomFullError, type RelayStatus } from './relay'
import { connectByAddress, parseAddress } from './ws'
import { hostRatings, refreshRating, ticketFor } from './rating'

type Target = { kind: 'code'; code: string } | { kind: 'ip'; url: string; label: string }

let session: GameSession | null = null
let runtime: HostRuntime | null = null
let target: Target | null = null
let reconnecting = false
let chatSeq = 0

const set = useApp.setState

async function profileFor(room: string): Promise<Profile> {
  const p = useApp.getState().profile
  return {
    name: p.name.trim() || 'Игрок',
    color: p.color,
    avatar: p.avatar,
    token: await roomToken(p.token, room),
    appVersion: useApp.getState().appVersion,
  }
}

/** Хосту билет рейтинга: по нему он узнаёт наш аккаунт. Без сети играем вне зачёта. */
async function sendAccount(code: string) {
  const mine = session
  const ticket = await ticketFor(code).catch(() => null)
  if (ticket && session === mine) session?.send({ t: 'account', ticket })
}

const REJECTS: Record<RejectReason, string> = {
  version: 'У хоста другая версия игры. Обновитесь до одной версии.',
  full: 'В комнате нет мест.',
  kicked: 'Хост убрал тебя из комнаты.',
  locked: 'Хост закрыл вход в комнату.',
  closed: 'Хост закрыл игру.',
}

const ENGINE_ERRORS: [RegExp, string][] = [
  [/need at least two players/, 'Нужно хотя бы два игрока'],
  [/bad blinds/, 'Малый блайнд должен быть меньше большого, а большой не больше стека'],
  [/too many players/, 'За столом уже больше игроков, чем мест'],
  [/minimum is (\d+)/, 'Слишком маленькая ставка'],
  [/not enough chips/, 'Не хватает фишек'],
  [/rebuys are off/, 'Докупка выключена'],
]

function handlers(): SessionHandlers {
  return {
    onWelcome(you, view, avatars) {
      reconnecting = false
      set({ you, view, avatars, conn: 'online', screen: 'game', code: view.code, homeError: null })
      void sendAccount(view.code)
      resetScene(view)
    },
    onView(view) {
      set({ view })
      viewUpdate(view)
    },
    onEvents(_seq, events, view) {
      set({ view })
      enqueue(events, view)
    },
    onAvatar(id, avatar) {
      const avatars = { ...useApp.getState().avatars }
      if (avatar) avatars[id] = avatar
      else delete avatars[id]
      set({ avatars })
    },
    onChat(msg) {
      const s = useApp.getState()
      set({ chat: [...s.chat, { id: ++chatSeq, ...msg }].slice(-200), unread: s.unread + 1 })
      if (msg.from !== s.you) sound.play('message', { volume: 0.4 })
    },
    onReject(reason, hostVersion) {
      let text = REJECTS[reason]
      if (reason === 'version' && hostVersion) {
        text = `У хоста версия ${hostVersion}, у тебя ${useApp.getState().appVersion}. Обновитесь до одной версии.`
      }
      backHome(text)
    },
    onError(message) {
      set({ rejected: useApp.getState().rejected + 1 })
      const hit = ENGINE_ERRORS.find(([re]) => re.test(message))
      useApp.getState().toast(hit ? hit[1] : 'Хост не принял действие', 'error')
    },
    onDrop() {
      if (runtime) return
      void reconnect()
    },
  }
}

function backHome(error: string | null) {
  session?.close()
  session = null
  runtime?.dispose(true)
  runtime = null
  target = null
  reconnecting = false
  set({ screen: 'home', role: null, code: null, conn: 'idle', relay: 'connecting', you: null, view: null, shown: null, chat: [], unread: 0, log: [], homeError: error })
  useScene.setState({ handNo: 0, seats: {}, board: [], flights: [], live: false, toAct: null, banner: null })
  native?.flash(false)
  // Итог партии сервер мог досчитать только что: рейтинг подтянем сразу и чуть позже.
  void refreshRating()
  setTimeout(() => void refreshRating(), 4000)
}

async function open(t: Target): Promise<void> {
  const transport = t.kind === 'code' ? await connectByCode(t.code) : await connectByAddress(t.url)
  if (target !== t) {
    transport.close()
    throw new Error('cancelled')
  }
  if (!session) session = new GameSession(await profileFor(t.kind === 'code' ? t.code : t.url), handlers())
  session.attach(transport)
}

async function reconnect() {
  if (reconnecting || !target) return
  reconnecting = true
  set({ conn: 'reconnecting' })
  // Хост может перезапускать игру: ждём его до пары минут.
  const delays = [500, 1500, 3000, 5000, 8000, 12_000, 20_000, 30_000, 30_000, 30_000]
  for (const d of delays) {
    await new Promise((r) => setTimeout(r, d))
    if (!reconnecting || !target) return
    try {
      await open(target)
      return
    } catch {
      // следующая попытка
    }
  }
  backHome('Связь с хостом потеряна. Попробуй войти ещё раз.')
}

function onRelay(status: RelayStatus, error?: Error) {
  set({ relay: status })
  if (error instanceof CodeTakenError) useApp.getState().toast('Этот код занят другой игрой. Закончи игру и создай новую.', 'error')
}

export async function createGame() {
  const code = randomRoomCode()
  const saved = loadRaw<Partial<GameConfig>>('lastConfig')
  // Сохранённые настройки старых версий дополняем значениями по умолчанию.
  const config: GameConfig | undefined = saved ? { ...DEFAULT_CONFIG, ...pickConfig(saved) } : undefined
  const me = await profileFor(code)
  set({ role: 'host', code, conn: 'connecting', homeError: null })
  const relaySecret = randomHex(32)
  runtime = new HostRuntime({ code, hostToken: me.token, relaySecret, appVersion: useApp.getState().appVersion, config, onRelay, ratings: hostRatings(code, relaySecret) })
  session = new GameSession(me, handlers())
  target = null
  session.attach(runtime.ownTransport())
}

/** Незаконченная игра этого профиля (настройки у каждого профиля свои). */
export function savedGame(): SavedGame | null {
  const snap = loadRaw<SavedGame>('snapshot')
  if (!snap || snap.v !== 1 || !snap.relaySecret || snap.phase === 'finished') return null
  return snap
}

export async function resumeGame() {
  const snap = savedGame()
  if (!snap) return
  const me = await profileFor(snap.code)
  set({ role: 'host', code: snap.code, conn: 'connecting', homeError: null })
  runtime = new HostRuntime({
    code: snap.code,
    hostToken: snap.hostToken,
    relaySecret: snap.relaySecret,
    appVersion: useApp.getState().appVersion,
    restore: snap,
    onRelay,
    ratings: hostRatings(snap.code, snap.relaySecret),
  })
  session = new GameSession({ ...me, token: snap.hostToken }, handlers())
  target = null
  session.attach(runtime.ownTransport())
}

export function forgetSavedGame() {
  save('snapshot', null)
}

export async function joinByCode(code: string) {
  target = { kind: 'code', code }
  set({ role: 'guest', code, conn: 'connecting', homeError: null })
  try {
    await open(target)
  } catch (err) {
    if (target?.kind !== 'code' || target.code !== code) return
    target = null
    set({
      role: null,
      code: null,
      conn: 'idle',
      homeError:
        err instanceof NotFoundError
          ? `Комнаты ${formatCode(code)} нет. Проверь код или спроси хоста, открыта ли у него игра.`
          : err instanceof RoomFullError
            ? 'В этой комнате уже нет мест.'
            : 'Сервер игры не отвечает. Проверь интернет. Если не поможет, хост может включить вход по IP.',
    })
  }
}

export async function joinByAddress(input: string) {
  const url = parseAddress(input)
  if (!url) {
    set({ homeError: 'Адрес выглядит так: 95.31.4.12 или 26.10.0.5:47474' })
    return
  }
  target = { kind: 'ip', url, label: input.trim() }
  set({ role: 'guest', code: null, conn: 'connecting', homeError: null })
  const mine = target
  try {
    await open(mine)
  } catch {
    if (target !== mine) return
    target = null
    set({ role: null, conn: 'idle', homeError: `Не удалось подключиться к ${input.trim()}. Проверь адрес и что хост включил вход по IP.` })
  }
}

export function cancelJoin() {
  target = null
  set({ role: null, code: null, conn: 'idle' })
}

export function send(msg: ClientMessage) {
  session?.send(msg)
}

export function leaveGame() {
  if (runtime) {
    runtime.dispose(false)
    runtime = null
  } else {
    session?.send({ t: 'leave' })
  }
  backHome(null)
}

export function rememberConfig(config: GameConfig) {
  save('lastConfig', config)
}

export async function enableDirect(): Promise<DirectInfo | { error: string }> {
  if (!runtime) return { error: 'not-host' }
  return runtime.enableDirect()
}

export async function disableDirect() {
  await runtime?.disableDirect()
}

export function isHost() {
  return runtime !== null
}

export function latency(): number | null {
  return session?.latency ?? null
}

function pickConfig(c: Partial<GameConfig>): Partial<GameConfig> {
  const out: Partial<GameConfig> = {}
  for (const k of Object.keys(DEFAULT_CONFIG) as (keyof GameConfig)[]) {
    if (c[k] !== undefined && typeof c[k] === typeof DEFAULT_CONFIG[k]) (out as Record<string, unknown>)[k] = c[k]
  }
  return out
}
