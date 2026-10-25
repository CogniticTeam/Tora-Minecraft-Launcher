import { forwardToSelfHost } from './selfhostProxy.ts';
/** Community-only gateway. Account/Microsoft credentials never reach the origin. */
interface CommunityEnv {
  COMMUNITY_ORIGIN: string;
  COMMUNITY_GATEWAY_TOKEN: string;
  RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  WRITE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}
const origins = new Set(['http://xmcl.runtime', 'http://localhost:3000', 'https://community-api.cogniticteam.com', 'https://154.8.230.216']);
const identifier = 'ps_[a-f0-9]{32}';
const routes: Array<[RegExp, string[]]> = [
  [/^\/(health|v1\/community)$/, ['GET', 'HEAD']],
  [/^\/v1\/community\/posts$/, ['GET', 'HEAD', 'POST']],
  [new RegExp(`^/v1/community/posts/${identifier}$`), ['GET', 'HEAD', 'PATCH']],
  [new RegExp(`^/v1/community/posts/${identifier}/comments$`), ['GET', 'HEAD', 'POST']],
  [new RegExp(`^/v1/community/posts/${identifier}/(like|bookmark|accepted-answer)$`), ['PUT', 'DELETE']],
  [/^\/v1\/community\/me$/, ['GET', 'PUT']],
  [/^\/v1\/community\/categories$/, ['GET', 'HEAD']],
  [/^\/v1\/community\/notifications$/, ['GET']],
  [/^\/v1\/community\/notifications\/read$/, ['PUT']],
  [/^\/v1\/community\/reports$/, ['POST']],
  [/^\/v1\/community\/comments\/cm_[a-f0-9]{32}$/, ['PATCH']],
  [/^\/v1\/community\/moderation\/reports$/, ['GET']],
  [/^\/v1\/community\/moderation\/actions$/, ['POST']],
];
async function bounded(body: ReadableStream<Uint8Array> | null, maximum: number) {
  if (!body) return new Uint8Array();
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function communityGateway(request: Request, env: CommunityEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const origin = request.headers.get('Origin');
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  const json = (body: unknown, status = 200) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers });
  if (origin && !origins.has(origin)) return json({ error: { code: 'origin_not_allowed', message: '不允许的请求来源。' } }, 403);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  headers.set('Access-Control-Expose-Headers', 'Retry-After, X-Request-ID');
  const url = new URL(request.url);
  if (url.search.length > 2048) return json({ error: { code: 'invalid_query', message: '查询条件过长。' } }, 422);
  const route = routes.find(([pattern]) => pattern.test(url.pathname));
  if (!route) return json({ error: { code: 'not_found', message: '接口不存在。' } }, 404);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!route[1].includes(request.method)) {
    headers.set('Allow', route[1].join(', '));
    return json({ error: { code: 'method_not_allowed', message: '不支持此请求方式。' } }, 405);
  }
  let target: URL;
  try {
    target = new URL(env.COMMUNITY_ORIGIN);
    if (target.protocol !== 'https:' || target.hostname !== 'community-origin.cogniticteam.com' || target.username || target.password || target.port || target.pathname !== '/' || target.search || target.hash || !env.COMMUNITY_GATEWAY_TOKEN) throw new Error();
  } catch { return json({ error: { code: 'community_not_configured', message: '社区服务未配置。' } }, 503); }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const write = !['GET', 'HEAD'].includes(request.method);
  const limiter = write ? env.WRITE_LIMITER ?? env.RATE_LIMITER : env.RATE_LIMITER;
  if (limiter && !(await limiter.limit({ key: ip })).success) {
    headers.set('Retry-After', '60');
    return json({ error: { code: 'rate_limited', message: '操作较频繁，请稍后重试。' } }, 429);
  }
  let body: Uint8Array | undefined;
  if (write) {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: { code: 'json_required', message: '请求需要 JSON 内容。' } }, 415);
    try { body = await bounded(request.body, 98304); } catch { return json({ error: { code: 'body_too_large', message: '内容过大。' } }, 413); }
  }
  const authorization = request.headers.get('Authorization');
  if (authorization) {
    // Structural audience gate prevents accidentally forwarding a Microsoft/launcher token.
    // The origin subsequently verifies the ES256 signature and expiration with its pinned public key.
    try {
      if (!authorization.startsWith('Bearer ') || authorization.length > 4103) throw new Error();
      const parts = authorization.slice(7).split('.');
      if (parts.length !== 3) throw new Error();
      const decode = (v: string) => JSON.parse(atob(v.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(v.length / 4) * 4, '=')));
      const head = decode(parts[0]); const claims = decode(parts[1]);
      if (head.alg !== 'ES256' || head.kid !== 'tora-community-v1' || claims.aud !== 'tora-community' || claims.iss !== 'https://launcher-api.cogniticteam.com') throw new Error();
    } catch { return json({ error: { code: 'invalid_community_ticket', message: '社区会话无效。' } }, 401); }
  }
  const upstream = new Headers({ Authorization: `Bearer ${env.COMMUNITY_GATEWAY_TOKEN}`, Accept: 'application/json' });
  if (authorization) upstream.set('X-Community-Authorization', authorization);
  if (write) upstream.set('Content-Type', 'application/json');
  const key = request.headers.get('Idempotency-Key');
  if (key && key.length <= 100) upstream.set('Idempotency-Key', key);
  try {
    target.pathname = url.pathname; target.search = url.search;
    const response = await fetcher(target, { method: request.method, headers: upstream, body: body as BodyInit | undefined,
      redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status >= 300 && response.status < 400) throw new Error('redirect_rejected');
    if (!response.headers.get('content-type')?.includes('application/json') && request.method !== 'HEAD') throw new Error('invalid_response');
    const retry = response.headers.get('Retry-After'); if (retry && /^\d{1,5}$/.test(retry)) headers.set('Retry-After', retry);
    const requestId = response.headers.get('X-Request-ID'); if (requestId && /^[a-f0-9]{32}$/.test(requestId)) headers.set('X-Request-ID', requestId);
    if (request.method === 'HEAD') return new Response(null, { status: response.status, headers });
    const bytes = await bounded(response.body, 262144);
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (response.ok && url.pathname === '/health' && (value.service !== 'tora-community' || value.status !== 'ok')) throw new Error('invalid_response');
    if (response.ok && url.pathname === '/v1/community' && (value.service !== 'tora-community' || !['coming_soon', 'ready'].includes(value.status))) throw new Error('invalid_response');
    return json(value, response.status);
  } catch { return json({ error: { code: 'community_unavailable', message: '社区暂时无法连接，请稍后重试。' } }, 503); }
}
export default { async fetch(request: Request, env: CommunityEnv & { TORA_SELFHOST_ORIGIN?: string; TORA_INTERNAL_PROXY_TOKEN?: string }) {
  if (env.TORA_SELFHOST_ORIGIN) return forwardToSelfHost(request, env);
  const { socketOriginFetch } = await import('./communityOriginTransport.ts');
  return communityGateway(request, env, socketOriginFetch);
} };
