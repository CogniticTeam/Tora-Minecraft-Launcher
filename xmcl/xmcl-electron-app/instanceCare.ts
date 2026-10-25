export interface CareIssue { id: string; title: string; detail: string; evidence?: string; severity: 'error' | 'warning' | 'info'; action?: 'java' | 'memory' | 'repair' | 'mods' | 'snapshots' }
export interface EnvironmentManifest { schema: 1; minecraft: string; loaders: Record<string, string>; mods: { name: string; hash: string; size: number }[] }
export interface EnvironmentDifference { kind: 'game' | 'loader' | 'missing' | 'extra' | 'changed'; name: string; local: string; remote: string }
export interface SnapshotSummary { id: string; created: number; label: string; automatic: boolean; includesSaves: boolean; files: number; bytes: number; warnings: string[]; deleted?: boolean }
export interface CommunityResource { project: string; title: string; author: string; type: string; version: string; versionId: string; gameVersions: string[]; loaders: string[]; filename: string; size: number; sha512: string; url: string }
export interface InstanceCareClient {
  snapshots(path: string, trash?: boolean): Promise<SnapshotSummary[]>
  trashSnapshot(path:string,id:string):Promise<void>
  untrashSnapshot(path:string,id:string):Promise<void>
  emptySnapshotTrash(path:string):Promise<unknown>
  snapshotStorage(path:string):Promise<{used:number;limit:number;trashCount:number}>
  snapshot(path: string, label: string, saves: boolean): Promise<SnapshotSummary>
  restore(path: string, id: string): Promise<{ safety: SnapshotSummary }>
  diagnose(path: string): Promise<{ issues: CareIssue[]; checked: number; logAvailable: boolean }>
  environment(path: string): Promise<EnvironmentManifest>
  resource(source: string, minecraft?: string, loader?: string): Promise<CommunityResource>
  downloadResource(project: string, version: string): Promise<string>
}
