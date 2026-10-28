import type { RiverApi } from '../../../preload/api'

/** API Electron, если мы в приложении; в обычном браузере его нет. */
export const native: RiverApi | null = typeof window !== 'undefined' && window.river ? window.river : null

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
export const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)
