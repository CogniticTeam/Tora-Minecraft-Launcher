export const DEFAULT_XMCL_API_BASE_URL = 'https://154.8.230.216'
export const DEFAULT_XMCL_AI_API_BASE_URL = 'https://154.8.230.216'
export const DEFAULT_XMCL_SIGNALING_API_BASE_URL = 'https://154.8.230.216'

export const TORA_WEBSITE = DEFAULT_XMCL_API_BASE_URL

export interface XmclApiEndpoints {
  common: string
  ai: string
  signaling: string
}

export function resolveXmclApiEndpoints(
  override: unknown,
  onInvalid?: () => void,
): XmclApiEndpoints {
  const custom = validOrigin(override)
  if (custom && !['https://launcher-api.cogniticteam.com', 'https://launcher-ai.cogniticteam.com', 'https://launcher-signal.cogniticteam.com'].includes(custom)) {
    return {
      common: custom,
      ai: custom,
      signaling: custom,
    }
  }
  if (!custom && typeof override === 'string' && override.trim()) onInvalid?.()
  return {
    common: DEFAULT_XMCL_API_BASE_URL,
    ai: DEFAULT_XMCL_AI_API_BASE_URL,
    signaling: DEFAULT_XMCL_SIGNALING_API_BASE_URL,
  }
}

function validOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value.trim())
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      /(^|\.)xmcl\.(app|cn)$/i.test(url.hostname) ||
      url.hostname === 'xmcl-core-api.azurewebsites.net' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/+$/, '') !== ''
    ) return undefined
    return url.origin
  } catch {
    return undefined
  }
}
