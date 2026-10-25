import { contextBridge, ipcRenderer } from 'electron'
import type { TerracottaClient } from '../terracotta'

const client: TerracottaClient = {
  status: () => ipcRenderer.invoke('tora:terracotta', 'status'),
  prepare: () => ipcRenderer.invoke('tora:terracotta', 'prepare'),
  host: (player, instance) => ipcRenderer.invoke('tora:terracotta', 'host', player, instance),
  join: (room, player) => ipcRenderer.invoke('tora:terracotta', 'join', player, room),
  inspect: (room, instance) => ipcRenderer.invoke('tora:terracotta','inspect',room,instance),
  leave: () => ipcRenderer.invoke('tora:terracotta', 'leave'),
}
contextBridge.exposeInMainWorld('terracottaClient', client)
