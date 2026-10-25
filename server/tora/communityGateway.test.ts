import { test } from 'node:test';
import assert from 'node:assert/strict';
import { communityGateway } from './communityGateway.ts';
const env = { COMMUNITY_ORIGIN: 'https://community-origin.cogniticteam.com', COMMUNITY_GATEWAY_TOKEN: 'test-token-not-a-real-secret' };
const url = 'https://community-api.cogniticteam.com';
const fakeTicket = (aud = 'tora-community', alg = 'ES256') => [Buffer.from(JSON.stringify({ alg, typ: 'JWT', kid: 'tora-community-v1' })).toString('base64url'), Buffer.from(JSON.stringify({ aud, iss: 'https://launcher-api.cogniticteam.com' })).toString('base64url'), Buffer.alloc(64).toString('base64url')].join('.');

test('public reads only use dedicated origin credentials; unrelated paths never proxy', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), env.COMMUNITY_ORIGIN + '/v1/community');
    const h = new Headers(init?.headers);
    assert.equal(h.get('Authorization'), `Bearer ${env.COMMUNITY_GATEWAY_TOKEN}`);
    assert.equal(h.get('Cookie'), null);
    assert.equal(h.get('X-Community-Authorization'), null);
    return Response.json({ service: 'tora-community', status: 'ready' });
  };
  const response = await communityGateway(new Request(url + '/v1/community', { headers: { Origin: 'http://xmcl.runtime', Cookie: 'session=client' } }), env, fetcher);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://xmcl.runtime');
  assert.ok(!(await response.text()).includes(env.COMMUNITY_GATEWAY_TOKEN));
  for (const path of ['/auth', '/v1/chat/completions', '/downloads', '/config']) assert.equal((await communityGateway(new Request(url + path), env, fetcher)).status, 404);
  assert.equal(calls, 1);
});

test('community-only tickets, pagination and idempotency survive; spoofed identity headers do not', async () => {
  const ticket = fakeTicket();
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), env.COMMUNITY_ORIGIN + '/v1/community/posts?q=Fabric&limit=20');
    const h = new Headers(init?.headers);
    assert.equal(h.get('X-Community-Authorization'), 'Bearer ' + ticket);
    assert.equal(h.get('X-User-Id'), null);
    assert.equal(h.get('DPoP'), null);
    assert.equal(h.get('Cookie'), null);
    assert.equal(h.get('Idempotency-Key'), 'test-post-key-00001');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)), { title: 'a post' });
    return Response.json({ data: { id: 'a' } }, { status: 201 });
  };
  const response = await communityGateway(new Request(url + '/v1/community/posts?q=Fabric&limit=20', { method: 'POST', body: JSON.stringify({ title: 'a post' }), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ticket, 'Idempotency-Key': 'test-post-key-00001', 'X-User-Id': 'admin', DPoP: 'private-proof', Cookie: 'session=private' } }), env, fetcher);
  assert.equal(response.status, 201);
});

test('Microsoft and generic launcher tokens are rejected before the dedicated origin', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ data: [] }); };
  for (const token of ['not-a-ticket', fakeTicket('launcher', 'HS256'), fakeTicket('tora-community', 'RS256')]) {
    assert.equal((await communityGateway(new Request(url + '/v1/community/posts', { headers: { Authorization: 'Bearer ' + token } }), env, fetcher)).status, 401);
  }
  assert.equal(calls, 0);
});

test('unsupported methods and foreign origins never reach the server', async () => {
  const never: typeof fetch = async () => { throw new Error('unexpected network'); };
  assert.equal((await communityGateway(new Request(url + '/v1/community', { method: 'POST' }), env, never)).status, 405);
  assert.equal((await communityGateway(new Request(url + '/health', { headers: { Origin: 'https://foreign.example' } }), env, never)).status, 403);
  assert.equal((await communityGateway(new Request(url + '/v1/community/posts', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } }), env, never)).status, 204);
});

test('outages, malformed data and redirects cannot claim community is healthy', async () => {
  const failed: typeof fetch = async () => { throw new Error('offline'); };
  assert.equal((await communityGateway(new Request(url + '/health'), env, failed)).status, 503);
  const invalid: typeof fetch = async () => Response.json({ status: 'ok', service: 'unrelated' });
  assert.equal((await communityGateway(new Request(url + '/health'), env, invalid)).status, 503);
  const redirect: typeof fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://foreign.example' } });
  assert.equal((await communityGateway(new Request(url + '/health'), env, redirect)).status, 503);
});

test('rate limits, missing secrets and untrusted origins fail closed', async () => {
  const noNetwork: typeof fetch = async () => { throw new Error('unexpected network'); };
  assert.equal((await communityGateway(new Request(url + '/health'), { ...env, COMMUNITY_GATEWAY_TOKEN: '' }, noNetwork)).status, 503);
  assert.equal((await communityGateway(new Request(url + '/health'), { ...env, COMMUNITY_ORIGIN: 'https://untrusted.example' }, noNetwork)).status, 503);
  const response = await communityGateway(new Request(url + '/health'), { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } }, noNetwork);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
});

test('body bounds and upstream errors remain recoverable without proxying unlimited data', async () => {
  const noNetwork: typeof fetch = async () => { throw new Error('unexpected network'); };
  assert.equal((await communityGateway(new Request(url + '/v1/community/posts', { method: 'POST', body: 'x'.repeat(99000), headers: { 'Content-Type': 'application/json' } }), env, noNetwork)).status, 413);
  const huge: typeof fetch = async () => new Response(' '.repeat(270000), { headers: { 'Content-Type': 'application/json' } });
  assert.equal((await communityGateway(new Request(url + '/v1/community/posts'), env, huge)).status, 503);
  const conflict: typeof fetch = async () => Response.json({ error: { code: 'revision_conflict', message: 'Content changed' } }, { status: 409 });
  const response = await communityGateway(new Request(url + '/v1/community/posts'), env, conflict);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as any).error.code, 'revision_conflict');
});
