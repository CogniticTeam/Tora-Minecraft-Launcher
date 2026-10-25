/** TLS to the pinned community server, verified against its public CA IP certificate.
 * Uses Workers' documented outbound TCP/TLS API. No insecure TLS flags or arbitrary destinations.
 */
import { connect } from 'cloudflare:sockets';
import { decodeOriginResponse } from './communityOriginHttp.ts';

const IP = '154.8.230.216';
const MAX_WIRE = 327680;
const encoder = new TextEncoder();

export async function socketOriginFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== 'https://community-origin.cogniticteam.com') throw new Error('untrusted_origin');
  const method = init.method || 'GET';
  // HEAD is represented as GET internally so framing remains verifiable. Gateway strips the body.
  const wireMethod = method === 'HEAD' ? 'GET' : method;
  const headers = new Headers(init.headers);
  const body = init.body instanceof Uint8Array ? init.body : new Uint8Array();
  const allowed = ['authorization', 'accept', 'content-type', 'idempotency-key', 'x-community-authorization', 'dpop', 'origin', 'x-tora-proxy-token', 'x-tora-original-url', 'x-tora-client-ip'];
  const output = [`${wireMethod} ${url.pathname}${url.search} HTTP/1.1`, `Host: ${IP}`, 'Connection: close', 'Accept-Encoding: identity', `Content-Length: ${body.byteLength}`];
  for (const key of allowed) { const value = headers.get(key); if (value) output.push(`${key}: ${value}`); }
  const socket = connect({ hostname: IP, port: 443 }, { secureTransport: 'on', allowHalfOpen: false });
  void socket.closed.catch(() => {});
  const abort = () => { void socket.close().catch(() => {}); };
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (init.signal?.aborted) throw new Error('aborted');
    await socket.opened;
    const writer = socket.writable.getWriter();
    try { await writer.write(encoder.encode(output.join('\r\n') + '\r\n\r\n')); if (body.byteLength) await writer.write(body); } finally { writer.releaseLock(); }
    const reader = socket.readable.getReader();
    const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > MAX_WIRE) throw new Error('origin_body_too_large'); chunks.push(next.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return decodeOriginResponse(bytes);
  } finally { init.signal?.removeEventListener('abort', abort); await socket.close().catch(() => {}); }
}
