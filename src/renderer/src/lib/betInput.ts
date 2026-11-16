/** Поле показывает точную сумму без округления до десятых BB. */
export function betInput(chips: number, unit: number): string {
  return String(Number((chips / unit).toFixed(10))).replace('.', ',')
}

/** null — пустое поле, undefined — недопустимый ввод. Сумма хранится в фишках. */
export function parseBetInput(text: string, unit: number): number | null | undefined {
  if (!/^\d*(?:[.,]\d*)?$/.test(text)) return undefined
  if (text === '' || text === '.' || text === ',') return null
  const value = Number(text.replace(',', '.')) * unit
  return Number.isFinite(value) ? Math.round(value) : undefined
}
