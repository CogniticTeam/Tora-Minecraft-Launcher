import { contextBridge, ipcRenderer } from 'electron'
import type { CustomDownloadsClient } from '../customDownloads'
const client: CustomDownloadsClient = {
  choose: url => ipcRenderer.invoke('tora:custom-downloads', 'choose', url),
  start: (url, token) => ipcRenderer.invoke('tora:custom-downloads', 'start', url, token),
  list: () => ipcRenderer.invoke('tora:custom-downloads', 'list'),
  cancel: id => ipcRenderer.invoke('tora:custom-downloads', 'cancel', id),
  retry: id => ipcRenderer.invoke('tora:custom-downloads', 'retry', id),
  reveal: id => ipcRenderer.invoke('tora:custom-downloads', 'reveal', id),
}
contextBridge.exposeInMainWorld('customDownloads', client)
