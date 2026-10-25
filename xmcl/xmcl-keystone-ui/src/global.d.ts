declare module '*.webp' {
  const value: string
  export default value
}

declare module 'grid-layout-plus' {
  export const GridLayout: import('vue').Component<any, any, any, { size: number; remain: number }>
  export const GridItem: import('vue').Component<any, any, any, { w: number }>
}

declare module '@/assets/locales/index.json' {
  type Locale = {
    [range: string]: string
  }
  const locale: Locale
  export = locale
}

declare namespace JSX {
  interface IntrinsicAttributes {
    class?: any
    style?: any
  }
}

declare module '*.png' {
  const value: string
  export default value
}
declare module '*.svg' {
  const value: string
  export default value
}

interface File {
  /**
   * The real path to the file on the users filesystem
   */
  path: string
}

declare const multiplayerNetworkDiagnostics: import('@xmcl/runtime-api').NetworkDiagnostics

declare const terracottaClient: import('../../xmcl-electron-app/terracotta').TerracottaClient

declare const instanceCare: import('../../xmcl-electron-app/instanceCare').InstanceCareClient
declare const customDownloads: import('../../xmcl-electron-app/customDownloads').CustomDownloadsClient

declare const launcherUpdates: { preferences(): Promise<{channel: 'stable' | 'beta'; version: string; status?: {state:string;message:string}}>; setChannel(channel:string): Promise<unknown> }
