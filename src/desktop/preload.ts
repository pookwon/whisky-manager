import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from './ipc.js'

const api = Object.fromEntries(
  Object.entries(IPC_CHANNELS).map(([name, channel]) => [
    name,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
)

contextBridge.exposeInMainWorld('wm', api)
