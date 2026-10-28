import { T } from '../../../protocol/index.ts'
import type { TableView, ViewEvent } from '../../../protocol/index.ts'
import { sound } from '../audio/sound'
import { chips } from '../lib/format'
import { native } from '../lib/native'
import { logEvent } from './log'
import { useApp } from '../store/app'
import { sceneFromView, useScene, type SceneSeat } from '../store/scene'
import { DECK, HERO_CARD, POT, seatPlaces, type SeatPlace } from '../table/geometry'

interface Batch {
  events: ViewEvent[]
  view: TableView
  receivedAt: number
}

const queue: Batch[] = []
let running = false
let generation = 0

function speed(): number {
  const s = useApp.getState().settings
  const base = s.speed === 'fast' ? 0.62 : 1
  return s.reduceMotion ? base * 0.6 : base
}

function wait(ms: number, gen: number): Promise<boolean> {
  return new Promise((resolve) => setTimeout(() => resolve(gen === generation), Math.max(0, ms)))
}

function later(ms: number, gen: number, fn: () => void) {
  setTimeout(() => {
    if (gen === generation) fn()
  }, Math.max(0, ms))
}

export function placesFor(view: TableView | null, you: string | null): Map<number, SeatPlace> {
  if (!view) return new Map()
  const seated = view.players.filter((p) => p.seat !== null && p.status !== 'left')
  const heroSeat = seated.find((p) => p.id === you)?.seat ?? null
  return seatPlaces(
    seated.map((p) => p.seat!),
    heroSeat,
  )
}

function nameOf(view: TableView, id: string): string {
  return view.players.find((p) => p.id === id)?.name ?? view.results.find((r) => r.id === id)?.name ?? 'Игрок'
}

/** Сцена сразу по состоянию хоста, без анимаций (вход, переподключение, догоняние). */
export function resetScene(view: TableView, receivedAt = performance.now()) {
  generation++
  queue.length = 0
  running = false
  applyView(view, receivedAt)
}

function applyView(view: TableView, receivedAt: number) {
  useApp.setState({ shown: view })
  const scene = useScene.getState()
  const next = sceneFromView(view, scene)
  if (view.turn && !view.paused) next.turnEndsAt = receivedAt + view.turn.remainingMs
  useScene.setState({ ...next, flights: [] })
}

let latest: { view: TableView; receivedAt: number } | null = null

/** Обновление без событий (лобби, связь). Во время анимаций откладываем до их конца. */
export function viewUpdate(view: TableView) {
  const receivedAt = performance.now()
  if (running) latest = { view, receivedAt }
  else applyView(view, receivedAt)
}

export function enqueue(events: ViewEvent[], view: TableView) {
  latest = null
  queue.push({ events, view, receivedAt: performance.now() })
  if (!running) void run()
}

async function run() {
  running = true
  const gen = generation
  while (queue.length && gen === generation) {
    const batch = queue.shift()!
    // Окно скрыто или очередь сильно отстала: сразу к итогу.
    if (document.hidden || queue.length > 4) {
      for (const e of batch.events) {
        logEvent(e, batch.view)
        sideEffects(e, batch.view, true)
      }
      applyView(batch.view, batch.receivedAt)
      continue
    }
    const catchUp = queue.length > 1 ? 0.45 : 1
    let revealed = false
    for (const e of batch.events) {
      if (gen !== generation) return
      const k = speed() * catchUp
      logEvent(e, batch.view)
      await step(e, batch.view, k, revealed, gen)
      if (e.t === 'reveal') revealed = true
    }
    if (gen !== generation) return
    applyView(batch.view, batch.receivedAt)
  }
  if (gen === generation) {
    running = false
    if (latest) {
      applyView(latest.view, latest.receivedAt)
      latest = null
    }
  }
}

function chipSound(amount: number, bb: number, allIn: boolean) {
  if (allIn) return sound.play('chips-handle-5', { volume: 0.9 })
  if (amount <= bb * 2) return sound.play('chipsStack', { volume: 0.75 })
  return sound.play('chipsHandle', { volume: 0.85 })
}

async function step(e: ViewEvent, view: TableView, k: number, revealed: boolean, gen: number) {
  const S = useScene.getState()
  const you = useApp.getState().you
  const places = placesFor(view, you)
  const place = (seat: number) => places.get(seat)
  const bb = view.blinds.bb

  switch (e.t) {
    case 'start': {
      const seats: Record<number, SceneSeat> = {}
      for (const s of e.seats) {
        seats[s.seat] = { seat: s.seat, id: s.id, stack: s.stack, bet: 0, folded: false, allIn: false, cards: null, label: null, handName: null }
      }
      S.set({
        handNo: e.handNo,
        live: true,
        button: e.button,
        board: [],
        pot: 0,
        seats,
        toAct: null,
        turnEndsAt: null,
        winners: [],
        best: null,
        banner: null,
        flights: [],
        epoch: S.epoch + 1,
      })
      sound.play('card-shuffle', { volume: 0.55, jitter: 0.02 })
      await wait(T.handStart * k, gen)
      return
    }

    case 'post': {
      const p = place(e.seat)
      const dur = 320 * k
      if (p) {
        S.addFlight({ kind: 'chips', from: p.pos, to: e.kind === 'ante' ? POT : p.bet, amount: e.amount, delay: 0, duration: dur, small: true })
      }
      sound.play('chipLay', { volume: 0.6 })
      later(dur, gen, () => {
        const st = useScene.getState()
        st.patchSeat(e.seat, (s) => ({
          stack: s.stack - e.amount,
          bet: e.kind === 'ante' ? s.bet : s.bet + e.amount,
          allIn: e.allIn,
          label: e.kind === 'ante' ? s.label : { kind: 'post', amount: s.bet + e.amount },
        }))
        if (e.kind === 'ante') st.set({ pot: useScene.getState().pot + e.amount })
      })
      await wait(T.post * k, gen)
      return
    }

    case 'deal': {
      const n = e.order.length
      const step = T.dealCard * k
      const dur = 380 * k
      for (let pass = 0; pass < 2; pass++) {
        e.order.forEach((seat, i) => {
          const p = place(seat)
          const delay = (pass * n + i) * step
          if (p) {
            const to = p.hero
              ? { x: p.cards.x + (pass === 0 ? -HERO_CARD.w * 0.32 : HERO_CARD.w * 0.32), y: p.cards.y }
              : { x: p.cards.x + (pass === 0 ? -12 : 12), y: p.cards.y }
            S.addFlight({ kind: 'card', from: DECK, to, amount: 0, delay, duration: dur, rotate: pass === 0 ? -6 : 6, small: !p.hero })
          }
          sound.play('deal', { volume: 0.6, delay })
          later(delay + dur, gen, () => {
            useScene.getState().patchSeat(seat, (s) => ({ cards: [...(s.cards ?? []), null] }))
          })
        })
      }
      const total = 2 * n * step + dur
      if (e.yours) {
        const heroSeat = [...places.values()].find((p) => p.hero)?.seat
        const yours = e.yours
        later(total + 60 * k, gen, () => {
          if (heroSeat === undefined) return
          useScene.getState().patchSeat(heroSeat, { cards: [...yours] })
          sound.play('place', { volume: 0.7 })
        })
      }
      await wait(Math.max(total + 120 * k, (2 * n * T.dealCard + T.dealTail) * k), gen)
      return
    }

    case 'act': {
      S.set({ toAct: null, turnEndsAt: null })
      const p = place(e.seat)
      if (e.kind === 'fold') {
        S.patchSeat(e.seat, { folded: true, cards: null, label: { kind: 'fold', amount: 0 } })
        sound.play('shove', { volume: 0.45 })
        await wait(T.fold * k, gen)
        return
      }
      if (e.kind === 'check') {
        S.patchSeat(e.seat, { label: { kind: 'check', amount: 0 } })
        sound.play('knock', { volume: 0.8 })
        sound.play('knock', { volume: 0.65, delay: 115 })
        await wait(T.check * k, gen)
        return
      }
      const dur = 380 * k
      if (p && e.added > 0) S.addFlight({ kind: 'chips', from: p.pos, to: p.bet, amount: e.added, delay: 0, duration: dur })
      chipSound(e.added, bb, e.allIn)
      later(dur, gen, () => {
        useScene.getState().patchSeat(e.seat, (s) => ({
          stack: s.stack - e.added,
          bet: e.bet,
          allIn: e.allIn,
          label: { kind: e.allIn ? 'allin' : e.kind, amount: e.bet },
        }))
      })
      await wait(T.bet * k, gen)
      return
    }

    case 'uncalled': {
      const p = place(e.seat)
      const dur = 360 * k
      if (p) S.addFlight({ kind: 'chips', from: p.bet, to: p.pos, amount: e.amount, delay: 0, duration: dur })
      S.patchSeat(e.seat, (s) => ({ bet: s.bet - e.amount }))
      sound.play('chipsStack', { volume: 0.5 })
      later(dur, gen, () => useScene.getState().patchSeat(e.seat, (s) => ({ stack: s.stack + e.amount })))
      await wait(T.uncalled * k, gen)
      return
    }

    case 'collect': {
      const dur = 460 * k
      const seats = Object.values(S.seats).filter((s) => s.bet > 0)
      seats.forEach((s, i) => {
        const p = place(s.seat)
        if (p) S.addFlight({ kind: 'chips', from: p.bet, to: POT, amount: s.bet, delay: i * 40 * k, duration: dur })
      })
      const cleared: Record<number, SceneSeat> = {}
      for (const s of Object.values(S.seats)) {
        cleared[s.seat] = {
          ...s,
          bet: 0,
          label: s.label && (s.label.kind === 'fold' || s.label.kind === 'allin') ? s.label : null,
        }
      }
      S.set({ seats: cleared })
      sound.burst('chipsCollide', Math.min(4, Math.max(1, seats.length)), 70, { volume: 0.7, delay: dur * 0.75 })
      later(dur + seats.length * 40 * k, gen, () => useScene.getState().set({ pot: e.total }))
      await wait(T.collect * k, gen)
      return
    }

    case 'board': {
      if (revealed) await wait(T.runoutSuspense * k, gen)
      const st = useScene.getState()
      st.set({ board: [...st.board, ...e.cards] })
      sound.play('shove', { volume: 0.55 })
      e.cards.forEach((_, i) => sound.play('place', { volume: 0.55, delay: (260 + i * 130) * k }))
      await wait((e.street === 'flop' ? T.flop : T.turnRiver) * k, gen)
      return
    }

    case 'reveal': {
      e.hands.forEach((h, i) => {
        later(i * 160 * k, gen, () => {
          useScene.getState().patchSeat(h.seat, { cards: [...h.cards] })
          sound.play('place', { volume: 0.55 })
        })
      })
      await wait(T.reveal * k, gen)
      return
    }

    case 'showdown': {
      const seats = { ...S.seats }
      for (const h of e.hands) if (seats[h.seat]) seats[h.seat] = { ...seats[h.seat]!, handName: h.name }
      S.set({ seats })
      await wait(T.showdown * k, gen)
      return
    }

    case 'award': {
      const dur = 560 * k
      const heroSeat = [...places.values()].find((p) => p.hero)?.seat
      e.winners.forEach((w, i) => {
        const p = place(w.seat)
        if (p) S.addFlight({ kind: 'chips', from: POT, to: p.pos, amount: w.amount, delay: i * 90 * k, duration: dur })
      })
      const names = e.winners.map((w) => nameOf(view, S.seats[w.seat]?.id ?? ''))
      const subtitle =
        e.winners.length > 1
          ? `${names.join(' и ')} делят ${chips(e.amount)}`
          : `${names[0]} забирает ${chips(e.amount)}`
      S.set({
        winners: [...new Set([...S.winners, ...e.winners.map((w) => w.seat)])],
        best: e.hand?.best ?? S.best,
        banner: { title: e.hand?.name ?? 'Все сбросили', subtitle },
      })
      for (const w of e.winners) S.patchSeat(w.seat, { label: { kind: 'win', amount: w.amount } })
      sound.play('chipsHandle', { volume: 0.9, delay: dur * 0.6 })
      if (heroSeat !== undefined && e.winners.some((w) => w.seat === heroSeat)) sound.play('win', { volume: 0.55, delay: 120 })
      else sound.play('chime', { volume: 0.35, delay: 120 })
      later(dur + 60, gen, () => {
        const st = useScene.getState()
        st.set({ pot: Math.max(0, st.pot - e.amount) })
        for (const w of e.winners) st.patchSeat(w.seat, (s) => ({ stack: s.stack + w.amount }))
      })
      await wait(T.award * k, gen)
      return
    }

    case 'end': {
      const st = useScene.getState()
      for (const s of e.stacks) st.patchSeat(s.seat, { stack: s.stack, bet: 0 })
      st.set({ live: false, toAct: null, turnEndsAt: null })
      await wait(T.end * k, gen)
      return
    }

    case 'turn': {
      S.set({ toAct: e.seat, turnTotal: e.totalMs })
      sideEffects(e, view, false)
      return
    }

    case 'timeout': {
      S.patchSeat(e.seat, { label: { kind: 'timeout', amount: 0 } })
      return
    }

    case 'show': {
      S.patchSeat(e.seat, { cards: [...e.cards] })
      sound.play('place', { volume: 0.6 })
      await wait(T.show * k, gen)
      return
    }

    default:
      sideEffects(e, view, false)
  }
}

/** Тосты и звуки, которые не зависят от анимаций. */
function sideEffects(e: ViewEvent, view: TableView, silent: boolean) {
  const app = useApp.getState()
  switch (e.t) {
    case 'level':
      if (e.level > 0) {
        app.toast(`Блайнды выросли: ${chips(e.blinds.sb)}/${chips(e.blinds.bb)}${e.blinds.ante ? `, анте ${chips(e.blinds.ante)}` : ''}`)
        if (!silent) sound.play('level', { volume: 0.5 })
      }
      return
    case 'bust': {
      const name = nameOf(view, e.id)
      app.toast(e.place ? `${name} выбывает: ${e.place} место` : `${name} без фишек`)
      return
    }
    case 'rebuy':
      app.toast(`${nameOf(view, e.id)} докупает ${chips(e.stack)}`)
      if (!silent) sound.play('chipsHandle', { volume: 0.5 })
      return
    case 'joined':
      if (e.id !== app.you) {
        app.toast(`${e.name} за столом`)
        if (!silent) sound.play('join', { volume: 0.5 })
      }
      return
    case 'left':
      app.toast(`${e.name} ушёл`)
      if (!silent) sound.play('leave', { volume: 0.45 })
      return
    case 'turn': {
      const heroSeat = view.players.find((p) => p.id === app.you)?.seat
      if (e.seat === heroSeat && !silent) {
        if (app.settings.turnSound) sound.play('turn', { volume: 0.6 })
        native?.flash(true)
      }
      return
    }
  }
}
