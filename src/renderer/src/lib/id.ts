export function randomToken(len = 32): string {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, (x) => abc[x % abc.length]).join('')
}

/** Шестизначный код комнаты без ведущего нуля. */
export function randomRoomCode(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(100000 + (buf[0]! % 900000))
}

export function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Токен игрока для конкретной комнаты. Хост видит токены гостей, поэтому
 * глобальный токен профиля наружу не уходит: в другой комнате он будет другим.
 */
export async function roomToken(profileToken: string, room: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`river:${room}:${profileToken}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)
}

/** Код восстановления рейтинга: 20 знаков без похожих букв (I, L, O, U). */
const RECOVERY_ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function newRecoveryCode(): string {
  const buf = new Uint8Array(20)
  crypto.getRandomValues(buf)
  return Array.from(buf, (x) => RECOVERY_ABC[x % 32]).join('')
}

/** Код, как его ввёл человек: регистр, дефисы и пробелы не важны, O читаем как 0, I и L как 1. */
export function parseRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{20}$/.test(s) ? s : null
}

export function formatRecoveryCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code
}
