import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DirectEvent, RiverApi, UpdateState } from './api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: RiverApi = {
  info: () => ipcRenderer.invoke('app:info'),
  flash: (on) => ipcRenderer.send('win:flash', on),
  toggleFullscreen: () => ipcRenderer.send('win:fullscreen'),
  keepAwake: (on) => ipcRenderer.send('app:awake', on),
  openExternal: (url) => ipcRenderer.send('app:open', url),
  direct: {
    start: (port) => ipcRenderer.invoke('direct:start', port),
    stop: () => ipcRenderer.invoke('direct:stop'),
    send: (conn, data) => ipcRenderer.send('direct:send', conn, data),
    close: (conn) => ipcRenderer.send('direct:close', conn),
    onEvent: (cb) => subscribe<DirectEvent>('direct:event', cb),
  },
  upnp: {
    map: (port) => ipcRenderer.invoke('upnp:map', port),
    unmap: () => ipcRenderer.invoke('upnp:unmap'),
  },
  net: {
    interfaces: () => ipcRenderer.invoke('net:interfaces'),
  },
  update: {
    onState: (cb) => subscribe<UpdateState>('update:state', cb),
    install: () => ipcRenderer.send('update:install'),
  },
}

contextBridge.exposeInMainWorld('river', api)
