import type { LauncherAppPlugin } from './LauncherAppPlugin'
export function isRetiredXmclService(value: string | URL): boolean {
  try {
    const url = new URL(value)
    return /(^|\.)xmcl\.(app|cn)$/i.test(url.hostname) ||
      ['xmcl-core-api.azurewebsites.net', 'xmcl.blob.core.windows.net', '20.239.69.131', '20.199.15.21', '20.215.243.212'].includes(url.hostname)
  } catch { return false }
}
/** No legacy URL can silently send credentials or requests to upstream services. */
export const pluginToraServiceGuard: LauncherAppPlugin = (app) => {
  const fetcher = app.fetch.bind(app)
  app.fetch = (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? input : input.url
    if (isRetiredXmclService(url)) return Promise.reject(new Error('上游 XMCL 服务已移除，请使用 TORA 自有服务'))
    return fetcher(input, init)
  }
  for (const scheme of ['http', 'https', 'ws', 'wss']) {
    app.protocol.registerHandler(scheme, ({ request, response }) => {
      if (!isRetiredXmclService(request.url)) return
      response.status = 410
      response.headers = { 'content-type': 'application/json' }
      response.body = JSON.stringify({ error: 'upstream_service_removed' })
      response.handled = true
    })
  }
}
