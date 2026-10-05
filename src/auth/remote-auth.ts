import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from "jose";
import { z } from "zod";

export interface RemoteConfig {
  issuer: string;
  resource: string;
  audience: string;
  readScope: string;
  subjectTenants: ReadonlyMap<string, readonly string[]>;
  allowedOrigins: readonly string[];
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
  const issuer = httpsUrl(process.env.MCP_KEYCLOAK_ISSUER, "MCP_KEYCLOAK_ISSUER");
  if (issuer.pathname.endsWith("/")) throw new Error("Use the exact Keycloak realm issuer without a trailing slash");
  const resource = httpsUrl(process.env.MCP_RESOURCE_URL, "MCP_RESOURCE_URL");
  if (!resource.pathname.endsWith("/mcp")) throw new Error("MCP_RESOURCE_URL must end in /mcp");
  const mapping = z.record(z.string().min(1), z.array(z.string().uuid()).nonempty()).parse(JSON.parse(process.env.MCP_SUBJECT_TENANTS_JSON ?? "{}"));
  if (!Object.keys(mapping).length) throw new Error("MCP_SUBJECT_TENANTS_JSON must explicitly authorize subjects");
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean).map((value) => {
    const url = httpsUrl(value.trim(), "MCP_ALLOWED_ORIGINS");
    if (url.pathname !== "/") throw new Error("Allowed origins must not contain paths");
    return url.origin;
  });
  const readScope = z.string().regex(/^[A-Za-z0-9:_-]+$/).parse(process.env.MCP_READ_SCOPE ?? "xero:read");
  const audience = process.env.MCP_AUDIENCE || resource.href;
  if (!audience.trim()) throw new Error("MCP_AUDIENCE must identify this resource");
  return { issuer: issuer.href, resource: resource.href, audience, readScope, subjectTenants: new Map(Object.entries(mapping)), allowedOrigins };
}

export function createAccessVerifier(config: RemoteConfig, suppliedKey?: JWTVerifyGetKey) {
  const key = suppliedKey ?? createRemoteJWKSet(new URL(`${config.issuer}/protocol/openid-connect/certs`), { timeoutDuration: 5000, cooldownDuration: 30000 });
  return async (token: string): Promise<readonly string[]> => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        issuer: config.issuer, audience: config.audience, algorithms: ["RS256"],
        requiredClaims: ["iss", "aud", "sub", "exp", "iat"], clockTolerance: 5,
      }));
      // Keycloak access tokens carry this claim; ID/refresh tokens are rejected.
      if (payload.typ !== "Bearer") throw new RemoteAuthError(401);
    } catch { throw new RemoteAuthError(401); }
    const scope = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    const allowed = config.subjectTenants.get(payload.sub!);
    if (!scope.includes(config.readScope) || !allowed?.length) throw new RemoteAuthError(403);
    return allowed;
  };
}
