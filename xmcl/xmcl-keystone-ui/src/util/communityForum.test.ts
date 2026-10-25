import { describe, expect, it, vi } from 'vitest'
import { CommunityError, createCommunityClient, parseCommunityExternalLink } from './communityForum'
import { renderCommunityMarkdown } from './communityMarkdown'

describe('real community client', () => {
  it('distinguishes verification outages from an expired Microsoft game login', async () => {
    const network = vi.fn<typeof fetch>()
    await expect(createCommunityClient(vi.fn().mockRejectedValue(new Error('minecraft_verification_unavailable')), network).request('/me', {auth:true})).rejects.toMatchObject({code:'minecraft_verification_unavailable',status:503})
    await expect(createCommunityClient(vi.fn().mockRejectedValue(new Error('minecraft_login_required')), network).request('/me', {auth:true})).rejects.toMatchObject({code:'minecraft_login_required',status:401})
    expect(network).not.toHaveBeenCalled()
  })
  it('allows public browsing without requesting identity or sending cookies', async () => {
    const access = vi.fn()
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }))
    await createCommunityClient(access, network).request('/posts')
    expect(access).not.toHaveBeenCalled()
    expect(network).toHaveBeenCalledWith(new URL('https://154.8.230.216/v1/community/posts'), expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
    expect(new Headers(network.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
  })
  it('refreshes community credentials once after expiry, preserving body and idempotency', async () => {
    const access = vi.fn().mockResolvedValueOnce({ accessToken: 'community-first', subject: 'device', expiresAt: '' }).mockResolvedValueOnce({ accessToken: 'community-new', subject: 'device', expiresAt: '' })
    const network = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: 'expired' } }, { status: 401 })).mockResolvedValueOnce(Response.json({ data: { id: 'new' } }))
    await createCommunityClient(access, network).request('/posts', { method: 'POST', auth: true, key: 'unique-idempotency-key', body: { title: 'hello' } })
    expect(access.mock.calls).toEqual([[false], [true]])
    for (const call of network.mock.calls) { expect(new Headers(call[1]?.headers).get('Idempotency-Key')).toBe('unique-idempotency-key'); expect(call[1]?.body).toBe('{"title":"hello"}') }
    expect(new Headers(network.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer community-new')
  })
  it('preserves recoverable server errors and rejects route escapes', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'rate_limited', message: '请稍后重试' } }, { status: 429, headers: { 'Retry-After': '30' } }))
    await expect(createCommunityClient(vi.fn(), network).request('/posts')).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 30 })
    await expect(createCommunityClient(vi.fn(), network).request('/../../auth')).rejects.toBeInstanceOf(CommunityError)
    expect(network).toHaveBeenCalledTimes(1)
  })
})
describe('untrusted forum content', () => {
  it('does not open privileged Electron application or localhost windows from untrusted posts', () => {
    for (const url of ['http://app/', 'http://xmcl.runtime/', 'http://localhost:3000/', 'https://localhost.evil.test/', 'file:///etc/hosts', 'https://user:secret@example.com/']) expect(() => parseCommunityExternalLink(url)).toThrow()
    expect(parseCommunityExternalLink('https://modrinth.com/mod/sodium')).toBe('https://modrinth.com/mod/sodium')
  })
  it('never executes raw HTML, loads remote images or permits script URLs', () => {
    const html = renderCommunityMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n![tracker](https://tracking.test/a.png)\n\n[click](javascript:alert(1))')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;script&gt;')
  })
  it('keeps fenced code escaped and provides a keyboard-accessible copy button', () => {
    const html = renderCommunityMarkdown('```html\n<script>doNotRun()</script>\n```')
    expect(html).toContain('class="community-code-actions"')
    expect(html).toContain('&lt;script&gt;doNotRun()&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
})
