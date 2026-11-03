import { useCallback } from 'react'
import { useApp } from '../store/app'
import { chips } from './format'

const NBSP = ' '

/** 250 при большом блайнде 100 → «2,5 BB». */
export function inBlinds(n: number, bb: number): string {
  const x = n / bb
  const s = x.toLocaleString('ru-RU', { maximumFractionDigits: 1 }).replace(/\s/g, NBSP)
  return `${s}${NBSP}BB`
}

/** Форматтер сумм за покерным столом: в фишках или в больших блайндах, как выбрал игрок. */
export function useMoney(): (n: number) => string {
  const on = useApp((s) => s.settings.inBlinds)
  const bb = useApp((s) => (s.view?.config.game === 'blackjack' ? 0 : (s.view?.blinds.bb ?? 0)))
  return useCallback((n: number) => (on && bb > 0 ? inBlinds(n, bb) : chips(n)), [on, bb])
}

export const BLINDS_TIP = 'Показать в фишках или в больших блайндах'

/** Щелчок по стеку, ставке или банку переключает единицы. */
export function toggleBlinds() {
  const s = useApp.getState()
  s.setSettings({ inBlinds: !s.settings.inBlinds })
}
