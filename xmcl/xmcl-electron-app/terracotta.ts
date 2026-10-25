import type { EnvironmentManifest, EnvironmentDifference } from './instanceCare'
export interface TerracottaSnapshot {
  phase: 'missing' | 'downloading' | 'starting' | 'ready' | 'error'
  state: string
  index: number
  version: string
  room?: string
  address?: string
  difficulty?: string
  error?: string
  transport?: 'relay' | 'direct'
  relayLatencyMs?: number
  gameLatencyMs?: number
  relayAvailable?: boolean
  profiles: { name: string; kind: string }[]
}

export interface TerracottaClient {
  status(): Promise<TerracottaSnapshot>
  prepare(): Promise<TerracottaSnapshot>
  host(player: string, instance?: string): Promise<TerracottaSnapshot>
  join(room: string, player: string): Promise<TerracottaSnapshot>
  inspect(room: string, instance?: string): Promise<{local?:EnvironmentManifest;remote?:EnvironmentManifest;differences:EnvironmentDifference[];warning?:string}>
  leave(): Promise<TerracottaSnapshot>
}
