import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_XMCL_AI_API_BASE_URL,
  DEFAULT_XMCL_API_BASE_URL,
  DEFAULT_XMCL_SIGNALING_API_BASE_URL,
  resolveXmclApiEndpoints,
  resolveXmclApiBaseUrl,
} from './xmclApiBaseUrl'

describe('resolveXmclApiBaseUrl', () => {
  it('normalizes a HTTPS origin and strips trailing slashes', () => {
    expect(resolveXmclApiBaseUrl('https://edge.example.test///')).toBe('https://edge.example.test')
  })

  it('falls back safely and warns when the override is not a HTTPS origin', () => {
    const logger = { warn: vi.fn() }

    expect(resolveXmclApiBaseUrl('http://example.test/api', logger)).toBe(DEFAULT_XMCL_API_BASE_URL)
    expect(logger.warn).toHaveBeenCalledWith(
      'Ignoring invalid xmclApiUrl flight; using default XMCL API origins.',
    )
  })

  it('uses the production API when the flight is absent', () => {
    expect(resolveXmclApiBaseUrl(undefined)).toBe(DEFAULT_XMCL_API_BASE_URL)
  })

  it('defines a separate production signaling origin', () => {
    expect(DEFAULT_XMCL_SIGNALING_API_BASE_URL).toBe('https://154.8.230.216')
  })

  it('resolves all production service origins together', () => {
    expect(resolveXmclApiEndpoints(undefined)).toEqual({
      common: DEFAULT_XMCL_API_BASE_URL,
      ai: DEFAULT_XMCL_AI_API_BASE_URL,
      signaling: DEFAULT_XMCL_SIGNALING_API_BASE_URL,
    })
  })

  it('uses one custom origin for all service surfaces', () => {
    expect(resolveXmclApiEndpoints('https://edge.example.test')).toEqual({
      common: 'https://edge.example.test',
      ai: 'https://edge.example.test',
      signaling: 'https://edge.example.test',
    })
  })
})

it('never accepts an upstream service as the custom origin', () => {
  expect(resolveXmclApiBaseUrl('https://api.xmcl.app')).toBe('https://154.8.230.216')
})

it('migrates stored official service origins while preserving custom endpoints', () => {
  for (const origin of ['https://launcher-api.cogniticteam.com', 'https://launcher-signal.cogniticteam.com', 'https://launcher-ai.cogniticteam.com']) {
    expect(resolveXmclApiEndpoints(origin)).toEqual({ common: DEFAULT_XMCL_API_BASE_URL, ai: DEFAULT_XMCL_AI_API_BASE_URL, signaling: DEFAULT_XMCL_SIGNALING_API_BASE_URL })
  }
})
