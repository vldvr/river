// Рейтинг игроков. Игрок узнаётся по коду восстановления: клиент присылает код,
// сервер хранит только его хеш (это и есть id аккаунта). Хост за столом видит лишь
// билеты гостей: подписанное сервером «аккаунт X сидит в комнате Y», без кода.
//
// POST /api/me     {secret, legacy?, existing?}          → {id, rating, games}
// POST /api/ticket {secret, code, legacy?}    → {ticket, id, rating, games}
// POST /api/seat   {ticket, code}             → {id, rating, games}           (хост проверяет гостя)
// POST /api/game   {game?, code, secret?, kind, hands, final, players:[{ticket, place, net}]}
//                                             → {game:{id,key}, done, changes?}
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { MAX_RATING, MIN_RATING, START_RATING, rankStandings, updateRatings } from './rating.mjs'

export const RULES = {
  /** Меньше раздач: партия не в зачёт (одна удачная раздача ничего не доказывает). */
  minHands: 15,
  /** Нужно хотя бы столько живых игроков с аккаунтом. Боты в рейтинге не участвуют. */
  minPlayers: 2,
  /** Хост пропал без итога: через столько партия засчитывается по последнему отчёту. */
  staleMs: 45 * 60_000,
  ticketMs: 24 * 3600_000,
  /** Перенос старого локального рейтинга при первом входе: не выше этого. */
  legacyMax: 1600,
}

const SECRET_RE = /^[0-9A-Z]{20}$/

export function accountId(secret) {
  return createHash('sha256').update(`river:${secret}`).digest('hex').slice(0, 24)
}

export function openAccounts(file = ':memory:', { now = () => Date.now() } = {}) {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, rating INTEGER NOT NULL, games INTEGER NOT NULL,
      created INTEGER NOT NULL, seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, key TEXT NOT NULL, code TEXT NOT NULL, kind TEXT NOT NULL,
      started INTEGER NOT NULL, updated INTEGER NOT NULL, hands INTEGER NOT NULL,
      standings TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS games_open ON games (done, updated);
  `)
  let key = db.prepare('SELECT v FROM meta WHERE k = ?').get('hmac')?.v
  if (!key) {
    key = randomBytes(32).toString('hex')
    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('hmac', key)
  }

  const q = {
    get: db.prepare('SELECT id, rating, games FROM accounts WHERE id = ?'),
    add: db.prepare('INSERT INTO accounts (id, rating, games, created, seen) VALUES (?, ?, ?, ?, ?)'),
    seen: db.prepare('UPDATE accounts SET seen = ? WHERE id = ?'),
    setRating: db.prepare('UPDATE accounts SET rating = ?, games = ? WHERE id = ?'),
    game: db.prepare('SELECT * FROM games WHERE id = ?'),
    addGame: db.prepare('INSERT INTO games (id, key, code, kind, started, updated, hands, standings) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    updGame: db.prepare('UPDATE games SET updated = ?, hands = ?, standings = ? WHERE id = ?'),
    doneGame: db.prepare('UPDATE games SET done = 1 WHERE id = ?'),
    stale: db.prepare('SELECT id FROM games WHERE done = 0 AND updated < ?'),
  }

  const sign = (payload) => createHmac('sha256', key).update(payload).digest('base64url')

  function account(secret, legacy, existing = false) {
    const id = accountId(secret)
    let row = q.get.get(id)
    // Вход по коду с другого компьютера: опечатка не должна молча завести пустой аккаунт.
    if (!row && existing) throw new ApiError(404, 'no account')
    if (!row) {
      // Первый вход: переносим локальный рейтинг из старых версий, но с потолком,
      // иначе подправленный профиль дал бы любое число.
      const rating = clampInt(legacy?.rating, MIN_RATING, RULES.legacyMax, START_RATING)
      const games = clampInt(legacy?.games, 0, 500, 0)
      q.add.run(id, rating, games, now(), now())
      row = { id, rating, games }
    } else q.seen.run(now(), id)
    return { id: row.id, rating: row.rating, games: row.games }
  }

  function ticket(id, code) {
    const payload = Buffer.from(JSON.stringify({ id, code, exp: now() + RULES.ticketMs })).toString('base64url')
    return `${payload}.${sign(payload)}`
  }

  /** Разбирает билет; просроченный годится, если `allowExpired` (игрок уже в этой партии). */
  function readTicket(t, code, allowExpired = false) {
    if (typeof t !== 'string' || t.length > 400) return null
    const [payload, mac] = t.split('.')
    if (!payload || !mac) return null
    const want = Buffer.from(sign(payload))
    const got = Buffer.from(mac)
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null
    let data
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    } catch {
      return null
    }
    if (data.code !== code) return null
    if (!allowExpired && data.exp < now()) return null
    return data.id
  }

  /** Засчитывает партию: Elo по последнему итогу, один раз. */
  function settle(row) {
    q.doneGame.run(row.id)
    const standings = JSON.parse(row.standings)
    if (row.hands < RULES.minHands || standings.length < RULES.minPlayers) return []
    const rows = standings.map((s) => ({ ...s, ...(q.get.get(s.id) ?? { rating: START_RATING, games: 0 }) }))
    const changes = updateRatings(rankStandings(rows))
    db.exec('BEGIN')
    try {
      for (const c of changes) q.setRating.run(c.rating, c.games, c.id)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return changes
  }

  /**
   * Отчёт хоста о партии. Первый отчёт создаёт её: хост доказывает, что держит
   * комнату `code` (секрет комнаты сверяет вызывающий через `ownsRoom`).
   */
  function report(body, ownsRoom) {
    const code = String(body.code ?? '')
    if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'bad code')
    if (body.kind !== 'tournament' && body.kind !== 'cash') throw new ApiError(400, 'bad kind')
    const hands = clampInt(body.hands, 0, 100_000, 0)
    if (!Array.isArray(body.players) || body.players.length > 9) throw new ApiError(400, 'bad players')

    let row = null
    if (body.game) {
      row = q.game.get(String(body.game.id ?? ''))
      const k = Buffer.from(String(body.game.key ?? ''))
      if (!row || row.code !== code || k.length !== row.key.length || !timingSafeEqual(k, Buffer.from(row.key))) {
        throw new ApiError(403, 'bad game')
      }
    } else if (!ownsRoom(code, body.secret)) throw new ApiError(403, 'not your room')
    if (row?.done) return { game: { id: row.id, key: row.key }, done: true }

    const known = new Set(row ? JSON.parse(row.standings).map((s) => s.id) : [])
    const standings = []
    for (const p of body.players) {
      const id = readTicket(p?.ticket, code, true)
      if (!id || standings.some((s) => s.id === id)) continue
      // Просроченный билет принимаем только у того, кто уже сидит в этой партии.
      if (!known.has(id) && !readTicket(p.ticket, code)) continue
      const place = p.place === null || p.place === undefined ? null : clampInt(p.place, 1, 9, null)
      const net = clampInt(p.net, -1e12, 1e12, 0)
      standings.push({ id, place, net })
    }
    // Ушедшие из прошлого отчёта остаются в партии со своим последним итогом.
    if (row) for (const s of JSON.parse(row.standings)) if (!standings.some((x) => x.id === s.id)) standings.push(s)

    const t = now()
    if (!row) {
      row = { id: randomBytes(9).toString('base64url'), key: randomBytes(18).toString('base64url'), code, kind: body.kind, started: t, hands: 0 }
      q.addGame.run(row.id, row.key, code, body.kind, t, t, 0, '[]')
    }
    // Раздачи не бывают быстрее нескольких секунд: хост не накрутит порог одним числом.
    const plausible = Math.floor((t - row.started) / 3000) + 1
    const counted = Math.min(Math.max(hands, row.hands), plausible)
    q.updGame.run(t, counted, JSON.stringify(standings), row.id)
    const out = { game: { id: row.id, key: row.key }, done: false }
    if (body.final) {
      out.done = true
      out.counted = counted >= RULES.minHands && standings.length >= RULES.minPlayers
      out.changes = settle({ ...row, hands: counted, standings: JSON.stringify(standings) })
    }
    return out
  }

  /** Партии, где хост пропал: засчитываем по последнему отчёту. */
  function settleStale() {
    for (const { id } of q.stale.all(now() - RULES.staleMs)) settle(q.game.get(id))
  }

  return {
    db,
    me(body) {
      return account(secretOf(body), body.legacy, body.existing === true)
    },
    ticket(body) {
      const code = String(body.code ?? '')
      if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'bad code')
      const acc = account(secretOf(body), body.legacy)
      return { ticket: ticket(acc.id, code), ...acc }
    },
    seat(body) {
      const id = readTicket(body.ticket, String(body.code ?? ''))
      if (!id) throw new ApiError(403, 'bad ticket')
      const row = q.get.get(id)
      if (!row) throw new ApiError(404, 'no account')
      return { id: row.id, rating: row.rating, games: row.games }
    },
    report,
    settleStale,
    close: () => db.close(),
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function secretOf(body) {
  const s = String(body.secret ?? '')
  if (!SECRET_RE.test(s)) throw new ApiError(400, 'bad secret')
  return s
}

function clampInt(v, min, max, fallback) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, Math.round(v)))
}

export { MAX_RATING }
