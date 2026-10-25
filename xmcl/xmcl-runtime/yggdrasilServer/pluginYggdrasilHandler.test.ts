import { AUTHORITY_DEV } from '@xmcl/runtime-api'
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verify } from 'node:crypto'

const services = vi.hoisted(() => ({
  peer: Symbol('kPeerFacade'),
  UserService: class {},
}))

vi.mock('~/peer', () => ({ kPeerFacade: services.peer }))
vi.mock('~/user', () => ({ UserService: services.UserService }))

import { pluginYggdrasilHandler } from './pluginYggdrasilHandler'

describe('pluginYggdrasilHandler', () => {
  let appDataPath: string
  beforeEach(async () => { appDataPath = await mkdtemp(join(tmpdir(), 'tmcl-yggdrasil-test-')) })
  afterEach(async () => { await rm(appDataPath, { recursive: true, force: true }) })
  it('returns resolved unsigned profile UUIDs from Yggdrasil endpoints', async () => {
    const profile = {
      id: '12345678-1234-1234-1234-123456789abc',
      name: 'reter',
      textures: {},
    }
    const app = {
      appDataPath,
      getLogger: vi.fn(() => ({ log: vi.fn() })),
      serverPort: Promise.resolve(25555),
      registry: {
        get: vi.fn(async () => ({
          state: {
            users: {
              offline: {
                authority: AUTHORITY_DEV,
                profiles: { [profile.id]: profile },
              },
            },
          },
        })),
      },
      protocol: { registerHandler: vi.fn() },
    }
    await pluginYggdrasilHandler(app as any, {} as any)
    const handler = app.protocol.registerHandler.mock.calls[0]![1]
    const response: Record<string, any> = { headers: {} }

    await handler({
      request: {
        method: 'GET',
        url: new URL('xmcl://launcher/yggdrasil/sessionserver/session/minecraft/hasJoined?username=reter'),
        headers: {},
      },
      response,
      handle: vi.fn(),
    })

    expect(response.status).toBe(200)
    const payload = JSON.parse(response.body)
    expect(payload).toMatchObject({
      id: '12345678123412341234123456789abc',
      name: profile.name,
    })
    const textureProperty = payload.properties.find((property: { name: string }) => property.name === 'textures')
    const textureInfo = JSON.parse(Buffer.from(textureProperty.value, 'base64').toString())
    expect(textureInfo.profileId).toBe('12345678123412341234123456789abc')
    expect(textureInfo.profileName).toBe(profile.name)

    const profileResponse: Record<string, any> = { headers: {} }
    await handler({
      request: {
        method: 'GET',
        url: new URL('xmcl://launcher/yggdrasil/sessionserver/session/minecraft/profile/12345678123412341234123456789abc?unsigned=false'),
        headers: {},
      },
      response: profileResponse,
      handle: vi.fn(),
    })

    expect(profileResponse.status).toBe(200)
    expect(JSON.parse(profileResponse.body)).toMatchObject({
      id: '12345678123412341234123456789abc',
      name: profile.name,
    })

    const metadata: Record<string, any> = { headers: {} }
    await handler({ request: { method: 'GET', url: new URL('xmcl://launcher/yggdrasil'), headers: {} }, response: metadata, handle: vi.fn() })
    const signedTexture = JSON.parse(profileResponse.body).properties.find((property: { name: string }) => property.name === 'textures')
    expect(verify('RSA-SHA1', Buffer.from(signedTexture.value), JSON.parse(metadata.body).signaturePublickey, Buffer.from(signedTexture.signature, 'base64'))).toBe(true)

    const joinResponse: Record<string, any> = { headers: {} }
    await handler({
      request: {
        method: 'POST',
        url: new URL('xmcl://launcher/yggdrasil/sessionserver/session/minecraft/join'),
        headers: {},
        body: Readable.from('{"accessToken":"token"}'),
      },
      response: joinResponse,
      handle: vi.fn(),
    })

    expect(joinResponse.status).toBe(240)
  })
})
