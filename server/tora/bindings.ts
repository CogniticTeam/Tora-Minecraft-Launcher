import type { DurableObjectNamespace } from '../src/cloudflare/types.ts';
declare module '../src/types.ts' {
  interface AppBindings {
    ACCOUNTS: DurableObjectNamespace;
    CACHE: {get(key:string,type?:'json'):Promise<any>;put(key:string,value:string,options?:{expirationTtl:number}):Promise<void>};
    RATE_LIMITER?: {limit(options:{key:string}):Promise<{success:boolean}>};
    AI_LIMITER?: {limit(options:{key:string}):Promise<{success:boolean}>};
    AI: {run(model:string,options:Record<string,unknown>):Promise<any>};
    ASSETS?: {get(key:string):Promise<{body:ReadableStream;httpEtag:string}|null>};
    TORA_SESSION_SECRET?: string;
    TORA_COMMUNITY_SIGNING_JWK?: string;
    TORA_COMMUNITY_VERIFY_TOKEN?: string;
    TORA_MULTIPLAYER_TICKET_SECRET?: string;
    TORA_MICROSOFT_CLIENT_ID?: string;
    TORA_MODRINTH_CLIENT_ID?: string;
    TORA_GOOGLE_CLIENT_ID?: string;
    TORA_DISCORD_CLIENT_ID?: string;
    TORA_TURN_KEY_ID?: string;
    TORA_TURN_API_TOKEN?: string;
    TORA_AI_MODEL?: string;
  }
}
