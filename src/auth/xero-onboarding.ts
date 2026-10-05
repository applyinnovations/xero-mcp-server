import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { EncryptedTokenStore, StoredTokens } from "./token-store.js";
import type { RemoteConfig } from "./remote-auth.js";
import { createXeroAuthorization, exchangeXeroCode, getXeroConnections, XeroConnection } from "./xero-authorization.js";

type Phase = "launch" | "authorizing" | "exchanging" | "review" | "failed" | "saving" | "complete";
interface Transaction {
  id: string; owner: string; expires: number; nonceExpires: number; phase: Phase; ticket?: string; cookieHash?: Buffer;
  authorization: ReturnType<typeof createXeroAuthorization>; tokens?: StoredTokens; xeroSubject?: string;
  connections: XeroConnection[];
  renewRevokedGrant: boolean;
}
interface Options {
  origin: string; clientId: string; store: EncryptedTokenStore; allowedTenantIds?: readonly string[];
  fetcher?: typeof fetch; now?: () => number;
}
const cookieName = "__Host-xero-connect";
const digest = (value: string) => createHash("sha256").update(value).digest();
const equal = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
const browserPaths = new Set(["/xero/start", "/xero/callback", "/xero/result"]);
export class XeroOnboardingError extends Error {
  constructor(public readonly status = 400) { super("Xero connection could not be completed; inspect setup or retry after review"); }
}

export class XeroOnboarding {
  private transaction?: Transaction;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private readonly origin: string;
  private readonly now: () => number;
  constructor(private readonly options: Options) {
    const origin = new URL(options.origin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("HTTPS onboarding origin required");
    this.origin = origin.origin;
    z.string().min(1).max(128).parse(options.clientId);
    this.now = options.now ?? Date.now;
  }

  private active() {
    if (this.transaction && this.now() > this.transaction.expires) { this.transaction = undefined; clearTimeout(this.expiryTimer); }
    return this.transaction;
  }
  private owned(owner: string, id: string) {
    const tx = this.active();
    if (!tx || !equal(tx.id, id) || tx.owner !== owner) throw new XeroOnboardingError(404);
    return tx;
  }
  private launch(tx: Transaction) {
    tx.authorization = createXeroAuthorization(this.options.clientId, `${this.origin}/xero/callback`);
    tx.ticket = randomBytes(32).toString("base64url"); tx.cookieHash = undefined;
    tx.nonceExpires = Math.min(this.now() + 300000, tx.expires); tx.phase = "launch";
    // Fragment capabilities do not appear in HTTP request URLs or ingress logs.
    return { transactionId: tx.id, startUrl: `${this.origin}/xero/start#ticket=${tx.ticket}`, expiresAt: tx.nonceExpires };
  }
  async begin(owner: string, renewRevokedGrant = false) {
    try {
      return await this.options.store.withLock(async () => {
        await this.options.store.validateKey();
        if (this.active()) throw new XeroOnboardingError(409);
        const existing = await this.options.store.hasState();
        if (existing && (!renewRevokedGrant || !(await this.options.store.read()).reauthorizeRequired || !this.options.allowedTenantIds?.length)) throw new XeroOnboardingError(409);
        if (!existing && renewRevokedGrant) throw new XeroOnboardingError(409);
        const tx: Transaction = { id: randomBytes(24).toString("base64url"), owner, expires: this.now() + 900000,
          nonceExpires: 0, phase: "launch", authorization: createXeroAuthorization(this.options.clientId, `${this.origin}/xero/callback`),
          connections: [], renewRevokedGrant };
        this.transaction = tx;
        clearTimeout(this.expiryTimer);
        this.expiryTimer = setTimeout(() => { if (this.transaction === tx) this.transaction = undefined; }, 900000);
        this.expiryTimer.unref();
        return this.launch(tx);
      });
    } catch (error) { if (error instanceof XeroOnboardingError) throw error; throw new XeroOnboardingError(); }
  }
  status(owner: string, id: string) {
    const tx = this.owned(owner, id);
    return { transactionId: tx.id, phase: tx.phase, connections: tx.connections,
      expiresAt: tx.expires, readsRequireTenantConfiguration: true };
  }
  next(owner: string, id: string) {
    const tx = this.owned(owner, id);
    const expiredLaunch = ["launch", "authorizing"].includes(tx.phase) && this.now() > tx.nonceExpires;
    if (!expiredLaunch && !["review", "failed"].includes(tx.phase)) throw new XeroOnboardingError(409);
    return this.launch(tx);
  }
  async confirm(owner: string, id: string, tenantIds: string[]) {
    const tx = this.owned(owner, id);
    const expected = z.array(z.string().uuid()).min(1).parse(tenantIds);
    const current = tx.connections.map(connection => connection.tenantId);
    if (tx.phase !== "review" || !tx.tokens || current.length !== expected.length || new Set(expected).size !== expected.length
      || expected.some(tenant => !current.includes(tenant)) || this.options.allowedTenantIds?.some(tenant => !expected.includes(tenant))) throw new XeroOnboardingError(409);
    tx.phase = "saving";
    try {
      const refreshedConnections = await getXeroConnections(tx.tokens.access_token, this.options.fetcher);
      if (this.active() !== tx || refreshedConnections.length !== expected.length || refreshedConnections.some(connection => !expected.includes(connection.tenantId))) throw new XeroOnboardingError();
      await this.options.store.withLock(async () => {
        if (this.active() !== tx) throw new XeroOnboardingError();
        const existing = await this.options.store.hasState();
        if (tx.renewRevokedGrant ? !existing || !(await this.options.store.read()).reauthorizeRequired : existing) throw new XeroOnboardingError(409);
        await this.options.store.write(tx.tokens!);
      });
      tx.tokens = undefined; tx.phase = "complete";
      return this.status(owner, id);
    } catch { tx.tokens = undefined; tx.phase = "failed"; throw new XeroOnboardingError(); }
  }

  private reply(response: ServerResponse, status: number, text: string, type = "text/plain; charset=utf-8") {
    response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" }); response.end(text);
  }
  async handleBrowser(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const path = request.url?.split("?")[0];
    if (!path || !browserPaths.has(path)) return false;
    if (request.headers.host !== new URL(this.origin).host || !request.url || request.url.length > 8192) throw new XeroOnboardingError();
    if (path === "/xero/result" && request.method === "GET") {
      this.reply(response, 200, "Return to your authenticated MCP client to review the connected organisations or retry."); return true;
    }
    if (path === "/xero/start" && request.method === "GET") {
      const nonce = randomBytes(16).toString("base64url");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'` });
      response.end(`<!doctype html><meta charset="utf-8"><title>Connect Xero</title><p id="message">Connecting to Xero…</p><script nonce="${nonce}">
const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket'); history.replaceState(null, '', '/xero/start');
if (!ticket) document.getElementById('message').textContent = 'Open the connection link from your authenticated MCP client.';
else fetch('/xero/start', {method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})})
.then(async response => {if(!response.ok)throw Error(); const result=await response.json(); const target=new URL(result.authorizationUrl); if(target.origin!=='https://login.xero.com')throw Error(); location.replace(target.href);})
.catch(() => {document.getElementById('message').textContent='Connection could not be started. Return to your MCP client and retry.';});</script>`);
      return true;
    }
    const tx = this.active();
    if (!tx || this.now() > tx.nonceExpires) throw new XeroOnboardingError();
    if (path === "/xero/start" && request.method === "POST") {
      if (request.headers.origin !== this.origin || !request.headers["content-type"]?.startsWith("application/json")) throw new XeroOnboardingError();
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 1024) throw new XeroOnboardingError(); chunks.push(chunk); }
      let input: { ticket: string };
      try { input = z.object({ ticket: z.string().max(128) }).strict().parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { throw new XeroOnboardingError(); }
      if (tx.phase !== "launch" || !tx.ticket || !equal(input.ticket, tx.ticket)) throw new XeroOnboardingError();
      const cookie = randomBytes(32).toString("base64url"); tx.cookieHash = digest(cookie); tx.ticket = undefined; tx.phase = "authorizing";
      response.setHeader("Set-Cookie", `${cookieName}=${cookie}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`);
      this.reply(response, 200, JSON.stringify({ authorizationUrl: tx.authorization.url }), "application/json"); return true;
    }
    if (path !== "/xero/callback" || request.method !== "GET") throw new XeroOnboardingError();
    const callback = new URL(request.url, this.origin);
    const states = callback.searchParams.getAll("state"); const codes = callback.searchParams.getAll("code"); const errors = callback.searchParams.getAll("error");
    const cookies = (request.headers.cookie ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
    if (tx.phase !== "authorizing" || states.length !== 1 || !equal(states[0], tx.authorization.state) || cookies.length !== 1 || !tx.cookieHash
      || !timingSafeEqual(digest(cookies[0].slice(cookieName.length + 1)), tx.cookieHash)
      || errors.length > 1 || (errors.length ? codes.length !== 0 : codes.length !== 1 || !codes[0] || codes[0].length > 4096)) throw new XeroOnboardingError();
    tx.phase = "exchanging"; tx.cookieHash = undefined;
    response.setHeader("Set-Cookie", `${cookieName}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    try {
      if (errors.length) throw new XeroOnboardingError();
      const exchanged = await exchangeXeroCode(this.options.clientId, `${this.origin}/xero/callback`, codes[0], tx.authorization.verifier, this.options.fetcher);
      if (this.active() !== tx || (tx.xeroSubject && tx.xeroSubject !== exchanged.subject)) throw new XeroOnboardingError();
      tx.xeroSubject = exchanged.subject; tx.tokens = exchanged.tokens;
      const connections = await getXeroConnections(exchanged.tokens.access_token, this.options.fetcher);
      if (this.active() !== tx || connections.length <= tx.connections.length
        || tx.connections.some(old => !connections.some(next => next.tenantId === old.tenantId))
        || connections.some(connection => this.options.allowedTenantIds?.length && !this.options.allowedTenantIds.includes(connection.tenantId))) throw new XeroOnboardingError();
      tx.connections = connections; tx.phase = "review";
    } catch { tx.phase = "failed"; }
    response.writeHead(303, { Location: `${this.origin}/xero/result`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); response.end();
    return true;
  }
}

export function configuredOnboarding(config: RemoteConfig): XeroOnboarding | undefined {
  if (!config.connectSubjects?.length) return undefined;
  const { XERO_TOKEN_FILE, XERO_TOKEN_KEY_FILE, XERO_CLIENT_ID } = process.env;
  if (!XERO_TOKEN_FILE || !XERO_TOKEN_KEY_FILE || !XERO_CLIENT_ID || process.env.XERO_CLIENT_SECRET || process.env.XERO_CLIENT_BEARER_TOKEN) throw new Error("Hosted onboarding requires durable public PKCE configuration");
  return new XeroOnboarding({ origin: new URL(config.resource).origin, clientId: XERO_CLIENT_ID,
    allowedTenantIds: (process.env.XERO_ALLOWED_TENANT_IDS ?? "").split(",").filter(Boolean).map(value => z.string().uuid().parse(value.trim())),
    store: new EncryptedTokenStore(XERO_TOKEN_FILE, XERO_TOKEN_KEY_FILE, XERO_CLIENT_ID) });
}
