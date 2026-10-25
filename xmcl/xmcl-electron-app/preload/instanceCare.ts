import { contextBridge, ipcRenderer } from 'electron'
import type { InstanceCareClient } from '../instanceCare'
const client: InstanceCareClient = {
  snapshots: (path,trash) => ipcRenderer.invoke('tora:instance-care', 'list', path,trash),
  trashSnapshot:(path,id)=>ipcRenderer.invoke('tora:instance-care','trash',path,id),
  untrashSnapshot:(path,id)=>ipcRenderer.invoke('tora:instance-care','untrash',path,id),
  emptySnapshotTrash:path=>ipcRenderer.invoke('tora:instance-care','empty-trash',path),
  snapshotStorage:path=>ipcRenderer.invoke('tora:instance-care','snapshot-storage',path),
  snapshot: (path, label, saves) => ipcRenderer.invoke('tora:instance-care', 'snapshot', path, { label, saves }),
  restore: (path, id) => ipcRenderer.invoke('tora:instance-care', 'restore', path, id),
  diagnose: path => ipcRenderer.invoke('tora:instance-care', 'diagnose', path),
  environment: path => ipcRenderer.invoke('tora:instance-care', 'environment', path),
  resource: (source, minecraft, loader) => ipcRenderer.invoke('tora:instance-care', 'resource', source, { minecraft, loader }),
  downloadResource: (project, version) => ipcRenderer.invoke('tora:instance-care', 'download-resource', project, version),
}
contextBridge.exposeInMainWorld('instanceCare', client)

contextBridge.exposeInMainWorld('launcherUpdates', { preferences: () => ipcRenderer.invoke('tora:instance-care','update-preferences'), setChannel: (channel: string) => ipcRenderer.invoke('tora:instance-care','set-update-channel',channel) })
