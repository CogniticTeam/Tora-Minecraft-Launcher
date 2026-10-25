import { describe, expect, it, vi } from 'vitest'
import { createCurseforgeFetch } from './curseforgeAccess'

describe('CurseForge authentication', () => {
  it.each([undefined, '', '   '])('never contacts the provider with missing key %s', async (key) => {
    const network = vi.fn<typeof fetch>()
    const fetcher = createCurseforgeFetch(key, network)
    await expect(fetcher('https://api.curseforge.com/v1/mods/search')).rejects.toThrow('not configured')
    expect(network).not.toHaveBeenCalled()
  })

  it('replaces a supplied header with the configured key and preserves request options', async () => {
    const response = new Response('{"data":[]}')
    const network = vi.fn<typeof fetch>().mockResolvedValue(response)
    const fetcher = createCurseforgeFetch(' test-key ', network)
    const signal = new AbortController().signal
    await expect(fetcher('https://api.curseforge.com/v1/mods', {
      method: 'POST', body: '{"modIds":[1]}', signal,
      headers: { 'X-Api-Key': 'renderer-key', 'Content-Type': 'application/json' },
    })).resolves.toBe(response)
    const [, init] = network.mock.calls[0]
    expect(init).toMatchObject({ method: 'POST', body: '{"modIds":[1]}', signal })
    expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  })
})
