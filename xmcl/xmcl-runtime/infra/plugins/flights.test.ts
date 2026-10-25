import { describe, expect, it, vi } from 'vitest'
import {
  applyDevelopmentApiFlight,
  applyRemoteFlights,
  DEVELOPMENT_XMCL_BILLING_API_BASE_URL,
  pluginFlights,
} from './flights'

describe('applyDevelopmentApiFlight', () => {
  it('forces local development onto the isolated staging API', () => {
    const flights = applyDevelopmentApiFlight(
      { xmclApiBaseUrl: 'https://api.xmcl.app', builtinAgent: true },
      'development',
    )

    expect(flights).toEqual({
      xmclApiBaseUrl: 'https://api.xmcl.app',
      xmclBillingApiBaseUrl: DEVELOPMENT_XMCL_BILLING_API_BASE_URL,
      builtinAgent: true,
    })
  })

  it('does not change production flights', () => {
    const flights = { xmclApiBaseUrl: 'https://api.xmcl.app' }

    expect(applyDevelopmentApiFlight(flights, 'production')).toBe(flights)
    expect(flights.xmclApiBaseUrl).toBe('https://api.xmcl.app')
  })

  it('does not persist the development-only staging override', () => {
    const effective: Record<string, any> = { builtinAgent: true }

    const persisted = applyRemoteFlights(
      effective,
      { xmclApiBaseUrl: 'https://api.xmcl.app' },
      'development',
    )

    expect(effective.xmclBillingApiBaseUrl).toBe(DEVELOPMENT_XMCL_BILLING_API_BASE_URL)
    expect(persisted.xmclApiBaseUrl).toBe('https://api.xmcl.app')
  })

  it('removes an inherited development override when remote flights omit it', () => {
    const effective: Record<string, any> = {
      xmclBillingApiBaseUrl: DEVELOPMENT_XMCL_BILLING_API_BASE_URL,
      builtinAgent: true,
    }

    const persisted = applyRemoteFlights(
      effective,
      { builtinAgent: true },
      'development',
    )

    expect(effective.xmclBillingApiBaseUrl).toBe(DEVELOPMENT_XMCL_BILLING_API_BASE_URL)
    expect(persisted).toEqual({ builtinAgent: true })
  })
})

it.each(['', 'example-key'])('exposes CurseForge availability without exposing its credential', async (key) => {
  vi.stubEnv('CURSEFORGE_API_KEY', key)
  try {
    const app = { protocol: { registerHandler: vi.fn() }, registry: { register: vi.fn() } }
    await pluginFlights(app as any, {} as any)
    const response: any = {}
    await app.protocol.registerHandler.mock.calls[0][1]({ request: { url: new URL('http://launcher/flights') }, response })
    const flags = JSON.parse(response.body.slice('window.flights = '.length))
    expect(flags.curseforgeAvailable).toBe(!!key)
    expect(Object.keys(flags)).not.toContain('CURSEFORGE_API_KEY')
    if (key) expect(response.body).not.toContain(key)
  } finally {
    vi.unstubAllEnvs()
  }
})
