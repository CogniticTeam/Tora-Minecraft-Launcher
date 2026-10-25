export interface CustomDownload {
  id: string
  name: string
  source: string
  destination: string
  state: 'downloading' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
  progress: number
  total: number
  speed: number
  started: number
  error?: string
  httpStatus?: number
}

export interface CustomDownloadsClient {
  choose(url: string): Promise<{ token: string; path: string } | undefined>
  start(url: string, token: string): Promise<CustomDownload>
  list(): Promise<CustomDownload[]>
  cancel(id: string): Promise<void>
  retry(id: string): Promise<CustomDownload>
  reveal(id: string): Promise<void>
}
