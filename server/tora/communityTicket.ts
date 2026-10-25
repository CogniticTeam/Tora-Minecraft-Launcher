import { AccountError } from '../src/account.ts';

const encode = (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

/** A separate signing key and audience; never exposes the account session secret. */
export async function issueCommunityTicket(privateJwk: string | undefined, subject: string, now = Date.now(), minecraft?: { id: string; name: string }) {
  if (!privateJwk) throw new AccountError(503, 'community_not_configured');
  const jwk = JSON.parse(privateJwk) as JsonWebKey;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) throw new AccountError(503, 'community_not_configured');
  const issued = Math.floor(now / 1000);
  const header = encode({ alg: 'ES256', typ: 'JWT', kid: 'tora-community-v1' });
  const payload = encode({ iss: 'https://launcher-api.cogniticteam.com', aud: 'tora-community', sub: minecraft ? `minecraft_${minecraft.id}` : subject,
    ...(minecraft ? { minecraft, launcher_sub: subject } : {}),
    scope: ['community:read', 'community:write'], iat: issued, exp: issued + 300, jti: crypto.randomUUID() });
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${payload}`)));
  const encoded = btoa(String.fromCharCode(...signature)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return { accessToken: `${header}.${payload}.${encoded}`, expiresAt: new Date((issued + 300) * 1000).toISOString(), subject: minecraft ? `minecraft_${minecraft.id}` : subject, ...(minecraft ? { minecraft } : {}) };
}

/** Only Mojang's authenticated profile response can establish a forum identity. */
export async function verifyCommunityMinecraft(token: unknown, fetcher: typeof fetch = fetch) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192 || !/^[A-Za-z0-9._~-]+$/.test(token)) throw new AccountError(401, 'minecraft_login_required');
  let response: Response;
  try {
    response = await fetcher('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch { throw new AccountError(503, 'minecraft_verification_unavailable'); }
  if (response.status === 429 || response.status >= 500) throw new AccountError(503, 'minecraft_verification_unavailable');
  if (!response.ok) throw new AccountError(401, 'minecraft_login_required');
  const data = await response.json() as { id?: unknown; name?: unknown };
  if (typeof data.id !== 'string' || !/^[a-f0-9]{32}$/i.test(data.id) || typeof data.name !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(data.name)) throw new AccountError(401, 'minecraft_login_required');
  return { id: data.id.toLowerCase(), name: data.name };
}
