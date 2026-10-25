import { afterEach, describe, expect, it, vi } from 'vitest'
import { getToraMicrosoftClientId, TORA_REGISTERED_MICROSOFT_CLIENT_ID } from '../../constant'
import { pluginFlights } from './flights'
import { pluginTelemetry } from './telemetry'
import { isRuntimeTelemetryEnabled, setRuntimeTelemetryEnabled } from '../telemetry_context'

describe('TORA runtime isolation', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the registered TORA Microsoft identity with an explicit deployment override', () => {
    vi.stubEnv('TORA_MICROSOFT_CLIENT_ID', undefined)
    expect(getToraMicrosoftClientId()).toBe(TORA_REGISTERED_MICROSOFT_CLIENT_ID)
    expect(TORA_REGISTERED_MICROSOFT_CLIENT_ID).toBe('1710c023-af88-403a-bcc3-59e0dda23f09')
    vi.stubEnv('TORA_MICROSOFT_CLIENT_ID', '  own-registered-client  ')
    expect(getToraMicrosoftClientId()).toBe('own-registered-client')
  })

  it('keeps renderer telemetry IPC callable without constructing network exporters', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>()
    const app = {
      fetch: vi.fn(), registry: { get: vi.fn() },
      controller: { handle: vi.fn((name, handler) => handlers.set(name, handler)) },
      getLogger: () => ({ log: vi.fn() }),
    }
    setRuntimeTelemetryEnabled(true)
    await pluginTelemetry(app as any, {} as any)
    expect(isRuntimeTelemetryEnabled()).toBe(false)
    expect([...handlers.keys()]).toEqual([
      'renderer-telemetry-exception', 'renderer-telemetry-flush',
      'renderer-telemetry-action-start', 'renderer-telemetry-action-end',
    ])
    for (const handler of handlers.values()) await handler(undefined, { message: 'test' })
    expect(app.fetch).not.toHaveBeenCalled()
    expect(app.registry.get).not.toHaveBeenCalled()
  })

  it('serves local flight flags without fetching remote policy or client identity', async () => {
    let handler: (context: any) => Promise<void>
    const app = {
      fetch: vi.fn(), registry: { get: vi.fn(), register: vi.fn() },
      protocol: { registerHandler: vi.fn((protocol, callback) => { handler = callback }) },
    }
    await pluginFlights(app as any, {} as any)
    const response: any = {}
    await handler!({ request: { url: new URL('http://launcher/flights') }, response })
    expect(response.status).toBe(200)
    expect(response.body).toBe('window.flights = {"builtinAgent":true,"toraDeviceSessions":true}')
    expect(app.fetch).not.toHaveBeenCalled()
    expect(app.registry.get).not.toHaveBeenCalled()
  })
})
