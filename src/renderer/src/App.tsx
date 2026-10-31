import { useEffect } from 'react'
import { Toasts } from './components/Toasts'
import { native } from './lib/native'
import { Game } from './screens/Game'
import { Home } from './screens/Home'
import { useApp } from './store/app'

export function App() {
  const screen = useApp((s) => s.screen)
  const felt = useApp((s) => s.settings.felt)
  const accent = useApp((s) => s.settings.accent)

  useEffect(() => {
    document.documentElement.dataset.felt = felt
    document.documentElement.dataset.accent = accent
  }, [felt, accent])

  useEffect(() => {
    if (!native) {
      useApp.setState({ appVersion: __APP_VERSION__ })
      return
    }
    void native.info().then((i) => useApp.setState({ appVersion: i.version }))
    return native.update.onState((update) => useApp.setState({ update }))
  }, [])

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
      <div className="grain" aria-hidden="true" />
    </>
  )
}
