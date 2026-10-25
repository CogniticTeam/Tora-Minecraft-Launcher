import { afterEach, describe, expect, it, vi } from 'vitest'
import { LauncherProtocolHandler } from './LauncherProtocolHandler'

vi.mock('~/infra', () => ({ kFlights: Symbol('flights') }))
vi.mock('~/xmclAccount/XmclAccountService', () => ({
  XmclAccountService: Symbol('account'), kXmclSessionAuthorization: Symbol('authorization'),
}))

const { pluginApiFallback } = await import('./pluginApiFallback')

function createProtocol() {
  const protocol = new LauncherProtocolHandler()
  const network = vi.fn(({ response }) => { response.status = 200 })
  pluginApiFallback({ protocol, registry: { get: async () => ({}) } } as any, {} as any)
  protocol.registerHandler('https', network, true)
  return { protocol, network }
}

afterEach(() => vi.unstubAllEnvs())

describe('CurseForge renderer protocol', () => {
  it('returns an explicit local configuration error without contacting CurseForge', async () => {
    vi.stubEnv('CURSEFORGE_API_KEY', ' ')
    const { protocol, network } = createProtocol()
    const response = await protocol.handle({ url: 'https://api.curseforge.com/v1/mods/search' })
    expect(response.status).toBe(503)
    expect(JSON.parse(response.body as string).error).toBe('curseforge_not_configured')
    expect(network).not.toHaveBeenCalled()
  })

  it('uses the configured key instead of a renderer header', async () => {
    vi.stubEnv('CURSEFORGE_API_KEY', ' test-key ')
    const { protocol, network } = createProtocol()
    await protocol.handle({ url: 'https://api.curseforge.com/v1/mods/search', headers: { 'X-Api-Key': 'untrusted' } })
    expect(network.mock.calls[0][0].request.headers).toEqual({ 'x-api-key': 'test-key' })
  })

  it('keeps Modrinth available and never sends the provider key to another host', async () => {
    vi.stubEnv('CURSEFORGE_API_KEY', 'test-key')
    const { protocol, network } = createProtocol()
    const response = await protocol.handle({ url: 'https://api.modrinth.com/v2/search' })
    expect(response.status).toBe(200)
    expect(network.mock.calls[0][0].request.headers).toEqual({})
  })
})
