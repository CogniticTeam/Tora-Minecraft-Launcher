import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueCommunityTicket, verifyCommunityMinecraft } from './communityTicket.ts';

test('community tickets use an independent ES256 key, short expiry and restricted audience/scopes', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey));
  const result = await issueCommunityTicket(jwk, 'device-test', 1800000000000);
  const [header, payload, signature] = result.accessToken.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.aud, 'tora-community');
  assert.equal(claims.sub, 'device-test');
  assert.equal(claims.exp - claims.iat, 300);
  assert.deepEqual(claims.scope, ['community:read', 'community:write']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${payload}`)), true);
  assert.equal('refreshToken' in result, false);
});
test('missing signing material fails closed', async () => {
  await assert.rejects(issueCommunityTicket(undefined, 'device-test'), /community_not_configured/);
});

test('official identity is derived from Mojang, never a supplied display name or UUID', async () => {
  const profile = await verifyCommunityMinecraft('test-token-not-a-real-secret', (async (url, init) => {
    assert.equal(String(url), 'https://api.minecraftservices.com/minecraft/profile');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token-not-a-real-secret');
    return Response.json({ id: 'a'.repeat(32), name: 'RealPlayer' });
  }) as typeof fetch);
  const keys = await crypto.subtle.generateKey({ name:'ECDSA',namedCurve:'P-256' }, true, ['sign','verify']);
  const result = await issueCommunityTicket(JSON.stringify(await crypto.subtle.exportKey('jwk',keys.privateKey)), 'device-test', Date.now(), profile);
  const claims = JSON.parse(Buffer.from(result.accessToken.split('.')[1], 'base64url').toString());
  assert.equal(claims.sub, 'minecraft_'+'a'.repeat(32));
  assert.equal(claims.minecraft.name, 'RealPlayer');
  assert.equal(claims.launcher_sub, 'device-test');
  assert.equal(result.accessToken.includes('test-token-not-a-real-secret'), false);
  await assert.rejects(verifyCommunityMinecraft('test-token-not-a-real-secret', (async () => new Response('',{status:401})) as typeof fetch), /minecraft_login_required/);
  await assert.rejects(verifyCommunityMinecraft('test-token-not-a-real-secret', (async () => new Response('',{status:503})) as typeof fetch), /minecraft_verification_unavailable/);
  await assert.rejects(verifyCommunityMinecraft('test-token-not-a-real-secret', (async () => Response.json({id:'bad',name:'Spoofed'})) as typeof fetch), /minecraft_login_required/);
});
