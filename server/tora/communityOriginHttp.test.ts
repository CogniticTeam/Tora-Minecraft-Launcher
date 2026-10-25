import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeOriginResponse } from './communityOriginHttp.ts';
const wire = (text: string) => new TextEncoder().encode(text);
test('TLS origin framing preserves UTF-8 JSON without decoding body bytes as headers', async () => {
  const body = JSON.stringify({ data: '中文帖子' });
  const response = decodeOriginResponse(wire(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${wire(body).byteLength}\r\nConnection: close\r\n\r\n${body}`));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).data, '中文帖子');
  assert.equal(response.headers.has('Connection'), false);
});
test('chunked origin messages are bounded and decoded correctly', async () => {
  const response = decodeOriginResponse(wire('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n7\r\n{"a":1}\r\n0\r\n\r\n'));
  assert.deepEqual(await response.json(), { a: 1 });
});
test('ambiguous, truncated and oversized responses are rejected', () => {
  assert.throws(() => decodeOriginResponse(wire('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n{}')), /ambiguous/);
  assert.throws(() => decodeOriginResponse(wire('HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\n{}')), /length/);
  assert.throws(() => decodeOriginResponse(wire('HTTP/1.1 200 OK\r\n\r\n' + 'x'.repeat(262145))), /too_large/);
  assert.throws(() => decodeOriginResponse(wire('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n8\r\n{}\r\n0\r\n\r\n')), /chunk/);
});
