// Import the store only after migration: its initializer creates a new identity on first use.
async function boot() {
  if (import.meta.env.MODE === 'relay-qa') {
    localStorage.clear()
    localStorage.setItem('river.relay', 'ws://127.0.0.1:47982/ws')
  }
  const ipc = (window as Window & { __TAURI_INTERNALS__?: { invoke<T>(cmd: string): Promise<T> } }).__TAURI_INTERNALS__
  const done = 'river.electronImport.v1'
  if (ipc && localStorage.getItem(done) === null && !localStorage.getItem('river.profile')) {
    const inserted: string[] = []
    try {
      const values = await ipc.invoke<Record<string, string>>('electron_saves')
      for (const [key, raw] of Object.entries(values)) {
        if (localStorage.getItem(key) !== null) continue
        localStorage.setItem(key, raw)
        inserted.push(key)
      }
      localStorage.setItem(done, '1')
    } catch (error) {
      if (import.meta.env.MODE === 'relay-qa') console.error(error)
      for (const key of inserted) localStorage.removeItem(key)
      const root = document.getElementById('root')!
      root.textContent = 'Не удалось перенести сохранения. Закрой предыдущую версию Ривера и повтори попытку. '
      const retry = document.createElement('button')
      retry.textContent = 'Повторить'
      retry.onclick = () => location.reload()
      root.append(retry)
      return
    }
  }
  await import('./render')
  if (import.meta.env.MODE === 'relay-qa') await import('./relay-qa')
}
void boot()
