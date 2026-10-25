import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sign, verify } from 'node:crypto'
import { localSigningIdentity } from './localSigningIdentity'

describe('local texture signing identity', () => {
  it('creates a usable private local identity and shares it across concurrent callers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tmcl-local-identity-'))
    try {
      const [first, second] = await Promise.all([localSigningIdentity(root), localSigningIdentity(root)])
      expect(first.publicKey).toBe(second.publicKey)
      vi.resetModules()
      const { localSigningIdentity: reload } = await import('./localSigningIdentity')
      expect((await reload(root)).publicKey).toBe(first.publicKey)
      const bytes = Buffer.from('local texture fixture')
      expect(verify('RSA-SHA1', bytes, first.publicKey, sign('RSA-SHA1', bytes, first.privateKey))).toBe(true)
      if (process.platform !== 'win32') expect((await stat(join(root, 'identities/texture-signing.pem'))).mode & 0o077).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('does not reuse the same identity across different installations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tmcl-local-identities-'))
    try {
      const a = await localSigningIdentity(join(root, 'a')), b = await localSigningIdentity(join(root, 'b'))
      expect(a.publicKey).not.toBe(b.publicKey)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
