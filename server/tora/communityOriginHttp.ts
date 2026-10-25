const MAX_BODY = 262144;

export function decodeOriginResponse(bytes: Uint8Array): Response {
  const wire = new TextDecoder('latin1').decode(bytes);
  const split = wire.indexOf('\r\n\r\n');
  if (split < 0 || split > 16384) throw new Error('invalid_origin_headers');
  const lines = wire.slice(0, split).split('\r\n');
  const status = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(lines.shift() || '');
  if (!status || Number(status[1]) < 200 || Number(status[1]) > 599) throw new Error('invalid_origin_status');
  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 1 || /^[ \t]/.test(line)) throw new Error('invalid_origin_header');
    headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  let body = bytes.slice(split + 4);
  const transfer = headers.get('transfer-encoding');
  const length = headers.get('content-length');
  if (transfer && length) throw new Error('ambiguous_origin_length');
  if (transfer) {
    if (transfer.toLowerCase() !== 'chunked') throw new Error('invalid_origin_encoding');
    const chunks: Uint8Array[] = []; let offset = 0; let total = 0;
    while (true) {
      let end = offset;
      while (end + 1 < body.length && !(body[end] === 13 && body[end + 1] === 10)) end++;
      const line = new TextDecoder().decode(body.slice(offset, end));
      if (!/^[a-f0-9]{1,8}(?:;[^\r\n]*)?$/i.test(line) || end - offset > 100) throw new Error('invalid_origin_chunk');
      const size = parseInt(line.split(';')[0], 16); offset = end + 2;
      if (size === 0) break;
      total += size;
      if (total > MAX_BODY || offset + size + 2 > body.length || body[offset + size] !== 13 || body[offset + size + 1] !== 10) throw new Error('invalid_origin_chunk');
      chunks.push(body.slice(offset, offset + size)); offset += size + 2;
    }
    body = new Uint8Array(total); offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    headers.delete('transfer-encoding');
  } else if (length && (!/^\d+$/.test(length) || Number(length) !== body.byteLength)) throw new Error('invalid_origin_length');
  if (body.byteLength > MAX_BODY) throw new Error('origin_body_too_large');
  headers.delete('connection'); headers.delete('content-encoding'); headers.delete('content-length');
  return new Response([204, 304].includes(Number(status[1])) ? null : body, { status: Number(status[1]), headers });
}

