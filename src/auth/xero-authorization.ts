import { createHash, randomBytes } from "node:crypto";
import { decodeJwt } from "jose";
import { z } from "zod";
import type { StoredTokens } from "./token-store.js";

export const onboardingScopes = ["offline_access", "accounting.banktransactions.read", "accounting.settings.read"] as const;
// Reuse the normal app-wide OAuth scope setting; callers cannot choose scopes.
export function approvedXeroScopes(scopes: readonly string[]): string[] {
  const approved = z.array(z.string().regex(/^[A-Za-z0-9:_./-]{1,128}$/)).min(1).max(64).parse(scopes);
  if (!approved.includes("offline_access")) throw new Error("Durable Xero consent requires offline_access");
  return [...new Set(approved)];
}

export function configuredXeroScopes(): string[] {
  const setting = process.env.XERO_SCOPES;
  return approvedXeroScopes(setting === undefined ? onboardingScopes : setting.trim().split(/\s+/));
}

// Tokens are from the fixed TLS token endpoint or the authenticated encrypted
// store, never a caller. Incoming MCP JWTs still use signature-verifying OIDC.
export function xeroTokenIdentity(accessToken: string, clientId: string) {
  return z.object({ iss: z.literal("https://identity.xero.com"), client_id: z.literal(clientId), sub: z.string().min(1),
    scope: z.union([z.string(), z.array(z.string())]) }).parse(decodeJwt(accessToken));
}

const tokenSchema = z.object({ access_token: z.string().min(1).max(16384), refresh_token: z.string().min(1).max(16384),
  expires_in: z.number().int().min(61).max(86400), token_type: z.literal("Bearer"), scope: z.string().optional() });
const connectionsSchema = z.array(z.object({ tenantId: z.string().uuid(), tenantType: z.literal("ORGANISATION"),
  tenantName: z.string().min(1).max(1000) }));
export type XeroConnection = z.infer<typeof connectionsSchema>[number];

export function createXeroAuthorization(clientId: string, redirectUri: string, scopes: readonly string[] = onboardingScopes) {
  const approved = approvedXeroScopes(scopes);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const url = new URL("https://login.xero.com/identity/connect/authorize");
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    scope: approved.join(" "), state, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
  return { url: url.href, state, verifier };
}

async function requestJson(url: string, options: RequestInit, fetcher: typeof fetch): Promise<unknown> {
  const signal = AbortSignal.timeout(10000);
  const response = await fetcher(url, { ...options, signal, redirect: "error" });
  if (!response.ok || response.redirected) { await response.body?.cancel(); throw new Error("Xero authorization request failed"); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty Xero response");
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      size += value.length; if (size > 65536) throw new Error("Oversized Xero response");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { signal.removeEventListener("abort", abort); await reader.cancel(); }
}

export async function exchangeXeroCode(clientId: string, redirectUri: string, code: string, verifier: string,
  fetcher: typeof fetch = fetch, now = Math.floor(Date.now() / 1000), scopes: readonly string[] = onboardingScopes) {
  const approved = approvedXeroScopes(scopes);
  const body = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code,
    redirect_uri: redirectUri, code_verifier: verifier });
  const response = tokenSchema.parse(await requestJson("https://identity.xero.com/connect/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body,
  }, fetcher));
  // This JWT is obtained directly from the fixed TLS token endpoint, never from
  // a caller. Decode only to compare the consenting Xero user across rounds.
  // Incoming MCP bearer tokens use the separate signature-verifying OIDC path.
  const issued = xeroTokenIdentity(response.access_token, clientId);
  const issuedScopes = typeof issued.scope === "string" ? issued.scope.split(" ") : issued.scope;
  const granted = response.scope === undefined ? issuedScopes : response.scope.split(" ").filter(Boolean);
  if (approved.some(scope => !granted.includes(scope)) || granted.some(scope => !approved.includes(scope))
    || granted.some(scope => !issuedScopes.includes(scope)) || issuedScopes.some(scope => !granted.includes(scope))) {
    throw new Error("Unexpected granted scopes");
  }
  return { subject: issued.sub, tokens: { access_token: response.access_token, refresh_token: response.refresh_token,
    expires_at: now + response.expires_in, scope: [...new Set(granted)].join(" ") } satisfies StoredTokens };
}

export async function getXeroConnections(accessToken: string, fetcher: typeof fetch = fetch): Promise<XeroConnection[]> {
  const connections = connectionsSchema.parse(await requestJson("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  }, fetcher));
  return [...new Map(connections.map(connection => [connection.tenantId, connection])).values()];
}
