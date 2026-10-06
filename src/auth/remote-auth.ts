import { createRemoteJWKSet, customFetch, jwtVerify, JWTVerifyGetKey } from "jose";
import { z } from "zod";

export interface RemoteConfig {
  issuer: string;
  jwksUrl?: string;
  accessTokenProfile: "rfc9068" | "bearer-claim";
  resource: string;
  audience: string;
  readScope: string;
  subjectTenants: ReadonlyMap<string, readonly string[]>;
  allowedOrigins: readonly string[];
  connectSubjects?: readonly string[];
  connectScope?: string;
  connectClientId?: string;
}

export interface VerifiedAccess {
  subject: string;
  scopes: readonly string[];
  tenantIds: readonly string[];
  clientId?: unknown;
}

export class RemoteAuthError extends Error {
  constructor(public readonly status: 401 | 403) { super("Remote MCP authorization failed"); }
}

function httpsUrl(value: string | undefined, label: string): URL {
  if (!value) throw new Error(`${label} is required`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error(`${label} must be an HTTPS URL without credentials, query or fragment`);
  return url;
}

export function loadRemoteConfig(): RemoteConfig {
  const issuer = httpsUrl(process.env.MCP_ISSUER, "MCP_ISSUER");
  const jwksUrl = process.env.MCP_JWKS_URL ? trustedJwksUrl(process.env.MCP_JWKS_URL, issuer.href).href : undefined;
  const accessTokenProfile = z.enum(["rfc9068", "bearer-claim"]).parse(process.env.MCP_ACCESS_TOKEN_PROFILE || "rfc9068");
  const resource = httpsUrl(process.env.MCP_RESOURCE_URL, "MCP_RESOURCE_URL");
  if (!resource.pathname.endsWith("/mcp")) throw new Error("MCP_RESOURCE_URL must end in /mcp");
  const mapping = z.record(z.string().min(1), z.array(z.string().uuid()).nonempty()).parse(JSON.parse(process.env.MCP_SUBJECT_TENANTS_JSON ?? "{}"));
  const onboarding = z.enum(["true", "false"]).parse(process.env.XERO_ONBOARDING_ENABLED ?? "false") === "true";
  const connectSubjects = onboarding ? z.array(z.string().min(1)).nonempty().parse(JSON.parse(process.env.MCP_CONNECT_SUBJECTS_JSON ?? "[]")) : undefined;
  const connectScope = onboarding ? z.string().regex(/^[A-Za-z0-9:_-]+$/).parse(process.env.MCP_CONNECT_SCOPE ?? "xero:connect") : undefined;
  const connectClientId = onboarding ? z.string().min(1).parse(process.env.MCP_CONNECT_CLIENT_ID) : undefined;
  if (!Object.keys(mapping).length && !connectSubjects?.length) throw new Error("MCP_SUBJECT_TENANTS_JSON must explicitly authorize subjects");
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean).map((value) => {
    const url = httpsUrl(value.trim(), "MCP_ALLOWED_ORIGINS");
    if (url.pathname !== "/") throw new Error("Allowed origins must not contain paths");
    return url.origin;
  });
  const readScope = z.string().regex(/^[A-Za-z0-9:_-]+$/).parse(process.env.MCP_READ_SCOPE ?? "xero:read");
  const audience = process.env.MCP_AUDIENCE || resource.href;
  if (!audience.trim()) throw new Error("MCP_AUDIENCE must identify this resource");
  return { issuer: process.env.MCP_ISSUER!, jwksUrl, accessTokenProfile, resource: resource.href, audience, readScope, subjectTenants: new Map(Object.entries(mapping)), allowedOrigins, connectSubjects, connectScope, connectClientId };
}

function trustedJwksUrl(value: string, issuer: string): URL {
  const url = httpsUrl(value, "JWKS URL");
  if (url.origin !== new URL(issuer).origin) throw new Error("JWKS must share the configured issuer's origin");
  return url;
}

// Trust originates only from administrator configuration, never token iss/jku/x5u.
// Bound the complete response, including body reads; jose handles key selection/rotation.
function boundedFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, options) => {
    const signal = AbortSignal.any([AbortSignal.timeout(5000), ...(options?.signal ? [options.signal] : [])]);
    const response = await fetcher(input, { ...options, signal, redirect: "manual" });
    if (response.status !== 200 || response.redirected) {
      await response.body?.cancel();
      throw new Error("Identity metadata request failed");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty identity metadata");
    const abortRead = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abortRead, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.length;
        if (size > 65536) throw new Error("Identity metadata exceeds limit");
        chunks.push(value);
      }
    } finally { signal.removeEventListener("abort", abortRead); await reader.cancel(); }
    return new Response(Buffer.concat(chunks), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

export function createAccessContextVerifier(config: RemoteConfig, suppliedKey?: JWTVerifyGetKey, fetcher: typeof fetch = fetch) {
  const get = boundedFetch(fetcher);
  let discoveredKey: Promise<JWTVerifyGetKey> | undefined;
  let retryAt = 0;
  async function resolveKey(): Promise<JWTVerifyGetKey> {
    if (discoveredKey) return discoveredKey;
    if (Date.now() < retryAt) throw new Error("Identity discovery unavailable");
    discoveredKey = (async () => {
      let jwksUrl = config.jwksUrl;
      if (!jwksUrl) {
        const discoveryUrl = `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
        const metadata = z.object({ issuer: z.literal(config.issuer), jwks_uri: z.string() }).parse(await (await get(discoveryUrl)).json());
        jwksUrl = metadata.jwks_uri;
      }
      return createRemoteJWKSet(trustedJwksUrl(jwksUrl, config.issuer), {
        timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000,
        [customFetch]: (url, options) => get(url, options),
      });
    })();
    try { return await discoveredKey; }
    catch { discoveredKey = undefined; retryAt = Date.now() + 30000; throw new Error("Identity discovery unavailable"); }
  }
  return async (token: string): Promise<VerifiedAccess> => {
    let payload;
    try {
      const requiredClaims = ["iss", "aud", "sub", "exp", "iat"];
      if (config.accessTokenProfile === "rfc9068") requiredClaims.push("client_id", "jti");
      const verified = await jwtVerify(token, suppliedKey ?? await resolveKey(), {
        issuer: config.issuer, audience: config.audience, algorithms: ["RS256"], requiredClaims, clockTolerance: 5,
        typ: config.accessTokenProfile === "rfc9068" ? "at+jwt" : "JWT",
      });
      payload = verified.payload;
      if (typeof payload.sub !== "string" || !payload.sub || typeof payload.iat !== "number" || !Number.isFinite(payload.iat) || typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.iat > Math.floor(Date.now() / 1000) + 5 || payload.exp <= payload.iat) throw new Error("Invalid token claims");
      if (config.accessTokenProfile === "rfc9068") {
        if (typeof payload.client_id !== "string" || !payload.client_id || typeof payload.jti !== "string" || !payload.jti) throw new Error("Invalid access-token profile");
      } else if (payload.typ !== "Bearer") throw new Error("Invalid access-token profile");
    } catch { throw new RemoteAuthError(401); }
    const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    return { subject: payload.sub!, scopes, tenantIds: config.subjectTenants.get(payload.sub!) ?? [],
      clientId: config.accessTokenProfile === "rfc9068" ? payload.client_id : payload.azp };
  };
}

export function createAccessVerifier(config: RemoteConfig, suppliedKey?: JWTVerifyGetKey, fetcher: typeof fetch = fetch) {
  const verify = createAccessContextVerifier(config, suppliedKey, fetcher);
  return async (token: string): Promise<readonly string[]> => {
    const context = await verify(token);
    if (!context.scopes.includes(config.readScope) || !context.tenantIds.length) throw new RemoteAuthError(403);
    return context.tenantIds;
  };
}

export function canConnectXero(config: RemoteConfig, context: VerifiedAccess): boolean {
  return !!config.connectScope && !!config.connectClientId && !!config.connectSubjects?.includes(context.subject)
    && context.scopes.includes(config.connectScope) && context.clientId === config.connectClientId;
}
