import { useEffect } from 'react'
import { releasesSince } from './changelog'
import { Toasts } from './components/Toasts'
import { native } from './lib/native'
import { loadRaw, save } from './lib/storage'
import { Game } from './screens/Game'
import { Home } from './screens/Home'
import { WhatsNew } from './screens/WhatsNew'
import { useApp } from './store/app'
import { refreshRating } from './net/rating'

export function App() {
  const screen = useApp((s) => s.screen)
  const felt = useApp((s) => s.settings.felt)
  const accent = useApp((s) => s.settings.accent)
  const appVersion = useApp((s) => s.appVersion)

  useEffect(() => {
    document.documentElement.dataset.felt = felt
    document.documentElement.dataset.accent = accent
  }, [felt, accent])

  useEffect(() => {
    void refreshRating()
  }, [])

  useEffect(() => {
    if (!native) {
      useApp.setState({ appVersion: __APP_VERSION__ })
      return
    }
    void native.info().then((i) => useApp.setState({ appVersion: i.version }))
    return native.update.onState((update) => useApp.setState({ update }))
  }, [])

  // После обновления показываем, что изменилось. Новому игроку показывать нечего.
  useEffect(() => {
    if (appVersion === '0.0.0') return
    const seen = loadRaw<string>('seenVersion')
    if (seen === null && !useApp.getState().profile.name) return save('seenVersion', appVersion)
    if (releasesSince(seen, appVersion).length) useApp.setState({ notes: { seen, all: false } })
    else if (seen !== appVersion) save('seenVersion', appVersion)
  }, [appVersion])

  // Клик по окну гасит мигание значка в панели задач.
  useEffect(() => {
    const onFocus = () => native?.flash(false)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  return (
    <>
      {screen === 'home' ? <Home /> : <Game />}
      <Toasts />
      <WhatsNew />
      <div className="grain" aria-hidden="true" />
    </>
  )
}
