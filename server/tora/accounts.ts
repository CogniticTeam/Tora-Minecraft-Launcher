import { Hono } from 'hono';
import { handleAccountError, jsonBody } from '../src/accountHttp.ts';
import { AccountError, AccountService } from '../src/account.ts';
import type { AccountRepository, Account, OAuthTransaction, SessionRecord, MergeRecord, IdempotencyRecord, AuditRecord } from '../src/account.ts';
import { SessionService } from '../src/session.ts';
import { AccountMergeService } from '../src/accountMerge.ts';
import { createSessionRoutes } from '../src/routes/session.ts';
import { createAccountRoutes } from '../src/routes/account.ts';
import { createMicrosoftOAuth } from '../src/oauth/microsoft.ts';
import { createModrinthOAuth } from '../src/oauth/modrinth.ts';
import { createGoogleOAuth } from '../src/oauth/google.ts';
import { createDiscordOAuth } from '../src/oauth/discord.ts';
import type { OAuthProvider } from '../src/oauth/types.ts';
import type { AppEnv } from '../src/types.ts';
import type { AccountRuntime } from '../src/accountRuntime.ts';
import { dpopJwkThumbprint,parseDpopPublicJwk,verifyDpopProof } from '../src/dpop.ts';
import { createCloudflareDpopReplayStore } from '../src/cloudflare/dpopReplay.ts';
import { xmclAuth } from '../src/middleware/xmclAuth.ts';
import { issueCommunityTicket, verifyCommunityMinecraft } from './communityTicket.ts';

export interface PersistentStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}
const key = (kind: string, ...parts: string[]) => `${kind}:${JSON.stringify(parts)}`;

/** Real Durable Object storage; no process-local account/session fallback. */
export class DurableAccountRepository implements AccountRepository {
  constructor(private readonly storage: PersistentStorage) {}
  getAccount(id: string) { return this.storage.get<Account>(key('account', id)); }
  saveAccount(value: Account) { return this.storage.put(key('account', value.accountId), value); }
  findIdentity(provider: OAuthProvider, subject: string) { return this.storage.get<{accountId:string}>(key('identity', provider, subject)); }
  async claimIdentity(provider: OAuthProvider, subject: string, accountId: string) {
    const existing = await this.findIdentity(provider, subject);
    if (existing) return existing;
    const value = {accountId};
    await this.storage.put(key('identity', provider, subject), value);
    return value;
  }
  async moveIdentity(provider: OAuthProvider, subject: string, from: string, to: string) {
    if ((await this.findIdentity(provider, subject))?.accountId !== from) throw new AccountError(409, 'identity_conflict');
    await this.storage.put(key('identity', provider, subject), {accountId:to});
  }
  async deleteIdentity(provider: OAuthProvider, subject: string) { await this.storage.delete(key('identity', provider, subject)); }
  getTransaction(id: string) { return this.storage.get<OAuthTransaction>(key('transaction', id)); }
  saveTransaction(value: OAuthTransaction) { return this.storage.put(key('transaction', value.transactionId), value); }
  getSession(id: string) { return this.storage.get<SessionRecord>(key('session', id)); }
  saveSession(value: SessionRecord) { return this.storage.put(key('session', value.sessionId), value); }
  async rotateSessionRefresh(value: SessionRecord, expected: string, now: string) {
    const current = await this.getSession(value.sessionId);
    if (!current || current.refreshHash !== expected || current.revokedAt || current.refreshExpiresAt <= now) return false;
    await this.saveSession(value); return true;
  }
  async revokeSessionIfRefreshConsumed(id: string, hash: string, revokedAt: string) {
    const value = await this.getSession(id);
    if (!value || value.revokedAt || !value.consumedRefreshHashes.includes(hash)) return false;
    await this.saveSession({...value, revokedAt}); return true;
  }
  getMerge(id: string) { return this.storage.get<MergeRecord>(key('merge', id)); }
  saveMerge(value: MergeRecord) { return this.storage.put(key('merge', value.mergeId), value); }
  getIdempotency(scope: string, id: string) { return this.storage.get<IdempotencyRecord>(key('idempotency', scope, id)); }
  saveIdempotency(value: IdempotencyRecord) { return this.storage.put(key('idempotency', value.scope, value.key), value); }
  saveAudit(value: AuditRecord) { return this.storage.put(key('audit', value.auditId), value); }
}

export function accountRuntime(repository: AccountRepository, env: Record<string, any>): AccountRuntime {
  if (!env.TORA_SESSION_SECRET || env.TORA_SESSION_SECRET.length < 32) throw new Error('Account service signing key is not configured');
  const redirectUris = (env.TORA_OAUTH_REDIRECT_URIS || '').split(',').filter(Boolean);
  return {
    accounts: new AccountService(repository), sessions: new SessionService(repository, env.TORA_SESSION_SECRET),
    merges: new AccountMergeService(repository),
    oauth: {
      microsoft: createMicrosoftOAuth({clientId:env.TORA_MICROSOFT_CLIENT_ID || '', redirectUris}),
      modrinth: createModrinthOAuth({clientId:env.TORA_MODRINTH_CLIENT_ID || '', clientSecret:env.TORA_MODRINTH_CLIENT_SECRET, redirectUris}),
      google: createGoogleOAuth({clientId:env.TORA_GOOGLE_CLIENT_ID || '', clientSecret:env.TORA_GOOGLE_CLIENT_SECRET, redirectUris}),
      discord: createDiscordOAuth({clientId:env.TORA_DISCORD_CLIENT_ID || '', clientSecret:env.TORA_DISCORD_CLIENT_SECRET, redirectUris}),
    },
  };
}

/** Account mutations are serialized across awaits, preventing OAuth consumption and identity races. */
export class ToraAccountObject {
  private queue: Promise<unknown> = Promise.resolve();
  private app: Hono<AppEnv>;
  private readonly persistentStorage: PersistentStorage;
  constructor(state: {storage:PersistentStorage}, private readonly env: Record<string, any>) {
    this.persistentStorage = state.storage;
    const runtime = accountRuntime(new DurableAccountRepository(state.storage), env);
    this.app = new Hono<AppEnv>();
    this.app.onError(handleAccountError);
    this.app.use('*', async (c,next) => { c.set('accountRuntime', runtime); await next(); });
    this.app.post('/v1/auth/device',async c=>{
      const body=await jsonBody(c);
      const jwk=parseDpopPublicJwk(body.dpopJwk);
      if(!jwk)return c.json({error:'device_public_key_required'},400);
      const thumbprint=await dpopJwkThumbprint(jwk);
      const proof=c.req.header('dpop');
      if(!proof)return c.json({error:'device_proof_required'},401);
      await verifyDpopProof({proof,method:'POST',url:c.req.url,expectedJkt:thumbprint,replayStore:createCloudflareDpopReplayStore(env.DPOP_REPLAY)});
      const id=`device_${thumbprint}`;
      let account=await runtime.accounts.repository.getAccount(id);
      if(!account){account={accountId:id,status:'active',createdAt:new Date().toISOString(),identities:[]};await runtime.accounts.repository.saveAccount(account)}
      if(account.status!=='active')return c.json({error:'device_disabled'},403);
      const session=await runtime.sessions.issue(id,undefined,thumbprint);
      return c.json({account:{accountId:id,status:account.status,createdAt:account.createdAt},identities:[],session});
    });
    this.app.post('/v1/account/community-ticket', xmclAuth(['account:read'], async () => runtime), async c => {
      const principal = await runtime.sessions.requireActiveSession(c.get('xmclPrincipal')!);
      await runtime.accounts.requireAccount(principal.accountId);
      c.header('Cache-Control', 'no-store');
      const raw = await c.req.text();
      if (raw.length > 16384) throw new AccountError(422, 'body_too_large');
      let body: Record<string, unknown> = {};
      try { body = raw ? JSON.parse(raw) : {}; if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error(); }
      catch { throw new AccountError(422, 'invalid_json'); }
      const minecraft = body.minecraftAccessToken === undefined ? undefined : await verifyCommunityMinecraft(body.minecraftAccessToken, env.TORA_COMMUNITY_VERIFY_TOKEN ? async (_url, init) => {
        const { socketOriginFetch } = await import('./communityOriginTransport.ts');
        return socketOriginFetch('https://community-origin.cogniticteam.com/internal/minecraft/profile', { method: 'POST', headers: { Authorization: `Bearer ${env.TORA_COMMUNITY_VERIFY_TOKEN}`, 'Content-Type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify({ accessToken: body.minecraftAccessToken })), signal: init?.signal });
      } : fetch);
      await runtime.sessions.requireActiveSession(principal);
      return c.json(await issueCommunityTicket(env.TORA_COMMUNITY_SIGNING_JWK, principal.accountId, Date.now(), minecraft));
    });
    this.app.route('/', createSessionRoutes(async () => runtime));
    this.app.route('/', createAccountRoutes(async () => runtime));
  }
  fetch(request: Request): Promise<Response> {
    const run = async () => {
      if (await this.persistentStorage.get('migration:frozen')) return Response.json({error:'service_migrated'}, {status:503,headers:{'Retry-After':'30'}});
      return this.app.fetch(request, {...this.env, XMCL_SESSION_SECRET:this.env.TORA_SESSION_SECRET});
    };
    // Profile verification is read-only and may take seconds. Recheck session validity
    // after it completes instead of blocking every account's mutation queue.
    if (request.method === 'POST' && new URL(request.url).pathname === '/v1/account/community-ticket') return run();
    const result = this.queue.then(run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
