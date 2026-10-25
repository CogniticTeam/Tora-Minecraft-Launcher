import { describe, expect, it, vi } from 'vitest'
import { COMMUNITY_API_ORIGIN, getCommunityInfo, isCommunityInfo } from './community'

const info = { service: 'tora-community', status: 'coming_soon', features: { posts: false, comments: false, likes: false } }

describe('community server connection', () => {
  it('only contacts the community origin and omits account cookies', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(info))
    const signal = new AbortController().signal
    await expect(getCommunityInfo(signal, network)).resolves.toEqual(info)
    expect(network).toHaveBeenCalledWith(`${COMMUNITY_API_ORIGIN}/v1/community`, expect.objectContaining({ credentials: 'omit', signal }))
  })

  it.each([{ ...info, service: 'tora-ai' }, { ...info, features: {} }, null, { status: 'ok' }])('rejects an unrelated or malformed service response', value => {
    expect(isCommunityInfo(value)).toBe(false)
  })

  it('does not treat a gateway outage or invalid data as a connected community', async () => {
    const offline = vi.fn<typeof fetch>().mockResolvedValue(new Response('offline', { status: 503 }))
    await expect(getCommunityInfo(undefined, offline)).rejects.toThrow('community_unavailable')
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ service: 'unrelated' }))
    await expect(getCommunityInfo(undefined, invalid)).rejects.toThrow('invalid_community_response')
  })
})
