export interface Scheduler {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** Ручные часы для тестов и симуляций: время идёт только через advance(). */
export class ManualScheduler implements Scheduler {
  private t = 0
  private seq = 0
  private queue: { at: number; id: number; fn: () => void }[] = []

  now() {
    return this.t
  }

  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq
    this.queue.push({ at: this.t + Math.max(0, ms), id, fn })
    return id
  }

  clearTimeout(handle: unknown) {
    this.queue = this.queue.filter((x) => x.id !== handle)
  }

  /** Прокручивает время, выполняя все таймеры по порядку. */
  advance(ms: number) {
    const until = this.t + ms
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = this.queue[0]
      if (!next || next.at > until) break
      this.queue.shift()
      this.t = next.at
      next.fn()
    }
    this.t = until
  }

  /** Выполняет следующий таймер, сколько бы до него ни было. */
  step(): boolean {
    this.queue.sort((a, b) => a.at - b.at || a.id - b.id)
    const next = this.queue.shift()
    if (!next) return false
    this.t = Math.max(this.t, next.at)
    next.fn()
    return true
  }

  get pending() {
    return this.queue.length
  }
}
