import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, JWK } from "jose";
import { createAccessVerifier, loadRemoteConfig, RemoteConfig } from "../remote-auth.js";

const tenant = "11111111-1111-4111-8111-111111111111";
const issuer = "https://identity.example.test/";
const config: RemoteConfig = { issuer, accessTokenProfile: "rfc9068", resource: "https://mcp.example.test/mcp", audience: "mcp-resource", readScope: "xero:read", subjectTenants: new Map([["alice", [tenant]]]), allowedOrigins: [] };
let privateKey: CryptoKey;
let rotatedKey: CryptoKey;
let jwk: JWK;
let rotatedJwk: JWK;
beforeAll(async () => {
  const first = await generateKeyPair("RS256");
  const second = await generateKeyPair("RS256");
  privateKey = first.privateKey; rotatedKey = second.privateKey;
  jwk = { ...await exportJWK(first.publicKey), alg: "RS256", kid: "first", use: "sig" };
  rotatedJwk = { ...await exportJWK(second.publicKey), alg: "RS256", kid: "second", use: "sig" };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
function discoveryMetadata(customConfig: RemoteConfig, jwksUri = new URL("/keys", customConfig.issuer).href) {
  return { issuer: customConfig.issuer, jwks_uri: jwksUri,
    authorization_endpoint: `${customConfig.issuer.replace(/\/$/, "")}/authorize`,
    token_endpoint: `${customConfig.issuer.replace(/\/$/, "")}/token`,
    response_types_supported: ["code"], subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}
function fixture(customConfig = config) {
  let metadata: unknown = discoveryMetadata(customConfig);
  let keys: unknown = { keys: [jwk] };
  let status = 200;
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    expect(options?.redirect).toBe("manual");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const value = String(url).endsWith("/.well-known/openid-configuration") ? metadata : keys;
    return new Response(JSON.stringify(value), { status });
  });
  return { fetcher, setMetadata: (value: unknown) => { metadata = value; }, setKeys: (value: unknown) => { keys = value; }, setStatus: (value: number) => { status = value; } };
}
function signed(customConfig = config, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: customConfig.issuer, aud: customConfig.audience, sub: "alice", iat: now, exp: now + 3600, client_id: "fixture-client", jti: "synthetic-token-id", scope: "openid xero:read", ...claims }).setProtectedHeader({ alg: "RS256", kid: "first", typ: "at+jwt", ...header }).sign(signingKey);
}

describe("synthetic provider contracts (no live-provider proof)", () => {
  it("discovers a trailing-slash issuer and verifies an RFC 9068 access token without payload typ", async () => {
    const network = fixture();
    const verify = createAccessVerifier(config, undefined, network.fetcher);
    await Promise.all([verify(await signed()), verify(await signed())]);
    expect(network.fetcher.mock.calls.map(([url]) => String(url))).toEqual([`${issuer}.well-known/openid-configuration`, `${issuer}keys`]);
  });
  it("discovers a synthetic Keycloak profile only when bearer-claim is explicitly selected", async () => {
    const kc: RemoteConfig = { ...config, issuer: "https://keycloak.example.test/realms/example", accessTokenProfile: "bearer-claim" };
    const network = fixture(kc);
    network.setMetadata(discoveryMetadata(kc, `${kc.issuer}/protocol/openid-connect/certs`));
    const verify = createAccessVerifier(kc, undefined, network.fetcher);
    expect(await verify(await signed(kc, { typ: "Bearer", client_id: undefined, jti: undefined }, { typ: "JWT" }))).toEqual([tenant]);
    await expect(verify(await signed(kc, { typ: "ID" }, { typ: "JWT" }))).rejects.toMatchObject({ status: 401 });
    await expect(verify(await signed(kc, { typ: "Bearer" }))).rejects.toMatchObject({ status: 401 });
    expect(String(network.fetcher.mock.calls[1][0])).toBe(`${kc.issuer}/protocol/openid-connect/certs`);
  });
  it("uses an explicit same-origin JWKS URL without discovery and ignores token key URLs", async () => {
    const network = fixture();
    const explicit = { ...config, jwksUrl: `${issuer}custom-keys` };
    expect(await createAccessVerifier(explicit, undefined, network.fetcher)(await signed(config, {}, { jku: "https://attacker.example/keys", x5u: "https://attacker.example/cert" }))).toEqual([tenant]);
    expect(network.fetcher.mock.calls.map(([url]) => String(url))).toEqual([explicit.jwksUrl]);
  });
  it.each([
    [{ iss: "https://other.example/" }, {}, 401], [{ aud: "oidc-login-client" }, {}, 401],
    [{ exp: 1 }, {}, 401], [{ iat: Math.floor(Date.now() / 1000) + 86400 }, {}, 401],
    [{ sub: "" }, {}, 401], [{ sub: 123 }, {}, 401], [{ iat: "yesterday" }, {}, 401], [{ sub: "unknown" }, {}, 403], [{ scope: ["xero:read"] }, {}, 403],
    [{ scope: "xero:read-other" }, {}, 403], [{ client_id: undefined }, {}, 401], [{ jti: "" }, {}, 401],
    [{}, { typ: "JWT" }, 401], [{ typ: "Bearer" }, { typ: "JWT" }, 401], [{}, { typ: "id+jwt" }, 401],
    [{}, { kid: "unknown" }, 401],
  ])("rejects invalid claims/profile %j %j", async (claims, header, status) => {
    const network = fixture();
    await expect(createAccessVerifier(config, undefined, network.fetcher)(await signed(config, claims, header))).rejects.toMatchObject({ status });
  });
  it("accepts the RFC media-type spelling application/at+jwt", async () => {
    const network = fixture();
    expect(await createAccessVerifier(config, undefined, network.fetcher)(await signed(config, {}, { typ: "application/at+jwt" }))).toEqual([tenant]);
  });
  it.each([
    { issuer: "https://other.example/", jwks_uri: `${issuer}keys` },
    { issuer, jwks_uri: "https://attacker.example/keys" },
    { issuer, jwks_uri: "http://identity.example.test/keys" },
    { issuer, jwks_uri: `${issuer}keys?untrusted=1` },
    {}, null,
  ])("fails closed on untrusted/malformed discovery %j", async (metadata) => {
    const network = fixture(); network.setMetadata(metadata);
    await expect(createAccessVerifier(config, undefined, network.fetcher)(await signed())).rejects.toMatchObject({ status: 401 });
    expect(network.fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds failed discovery retries and recovers without accepting a token during outage", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const network = fixture(); network.setStatus(503);
    const verify = createAccessVerifier(config, undefined, network.fetcher);
    const token = await signed();
    await expect(verify(token)).rejects.toMatchObject({ status: 401 });
    network.setStatus(200);
    await expect(verify(token)).rejects.toMatchObject({ status: 401 });
    expect(network.fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 31000);
    expect(await verify(token)).toEqual([tenant]);
  });
  it("rejects redirects, oversized metadata and network failures", async () => {
    for (const response of [new Response(null, { status: 302, headers: { Location: "https://attacker.example/" } }), new Response("x".repeat(65537))]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(createAccessVerifier(config, undefined, fetcher)(await signed())).rejects.toMatchObject({ status: 401 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    await expect(createAccessVerifier(config, undefined, vi.fn<typeof fetch>().mockRejectedValue(new Error("secret network detail")))(await signed())).rejects.toMatchObject({ status: 401, message: "Remote MCP authorization failed" });
  });
  it("cancels a stalled response body when the complete-response deadline fires", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let waiting!: () => void;
    const started = new Promise<void>((resolve) => { waiting = resolve; });
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ pull() { waiting(); }, cancel })));
    const result = createAccessVerifier(config, undefined, fetcher)(await signed());
    await started;
    controller.abort();
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(cancel).toHaveBeenCalled();
  });
  it("rejects missing timestamps, a future not-before time and symmetric signatures", async () => {
    for (const claims of [{ exp: undefined }, { iat: undefined }, { nbf: Math.floor(Date.now() / 1000) + 86400 }]) {
      const network = fixture();
      await expect(createAccessVerifier(config, undefined, network.fetcher)(await signed(config, claims))).rejects.toMatchObject({ status: 401 });
    }
    const symmetric = await new SignJWT({ iss: issuer, aud: config.audience, sub: "alice", scope: "xero:read" }).setProtectedHeader({ alg: "HS256", typ: "at+jwt" }).sign(new Uint8Array(32));
    const network = fixture();
    await expect(createAccessVerifier(config, undefined, network.fetcher)(symmetric)).rejects.toMatchObject({ status: 401 });
  });
  it("rejects malformed JWKS and a signature from an unrelated key", async () => {
    const network = fixture(); network.setKeys({ keys: "invalid" });
    await expect(createAccessVerifier(config, undefined, network.fetcher)(await signed())).rejects.toMatchObject({ status: 401 });
    const validNetwork = fixture();
    await expect(createAccessVerifier(config, undefined, validNetwork.fetcher)(await signed(config, {}, {}, rotatedKey))).rejects.toMatchObject({ status: 401 });
  });
  it("refreshes rotated keys after cooldown and rejects removed keys after cache expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const network = fixture();
    const verify = createAccessVerifier(config, undefined, network.fetcher);
    const original = await signed();
    expect(await verify(original)).toEqual([tenant]);
    network.setKeys({ keys: [rotatedJwk] });
    const rotated = await signed(config, {}, { kid: "second" }, rotatedKey);
    await expect(verify(rotated)).rejects.toMatchObject({ status: 401 });
    expect(network.fetcher).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 31000);
    expect(await verify(rotated)).toEqual([tenant]);
    expect(network.fetcher).toHaveBeenCalledTimes(3);
    vi.setSystemTime(Date.now() + 600001);
    await expect(verify(original)).rejects.toMatchObject({ status: 401 });
    expect(network.fetcher).toHaveBeenCalledTimes(4);
  });
  it("loads exact issuer, default profile, explicit JWKS and rejects unsafe admin configuration", () => {
    vi.stubEnv("MCP_ISSUER", issuer); vi.stubEnv("MCP_RESOURCE_URL", config.resource);
    vi.stubEnv("MCP_SUBJECT_TENANTS_JSON", JSON.stringify({ alice: [tenant] }));
    expect(loadRemoteConfig()).toMatchObject({ issuer, accessTokenProfile: "rfc9068" });
    vi.stubEnv("MCP_JWKS_URL", `${issuer}keys`);
    expect(loadRemoteConfig().jwksUrl).toBe(`${issuer}keys`);
    vi.stubEnv("MCP_JWKS_URL", "https://other.example/keys");
    expect(() => loadRemoteConfig()).toThrow("origin");
    vi.stubEnv("MCP_JWKS_URL", ""); vi.stubEnv("MCP_ACCESS_TOKEN_PROFILE", "guess");
    expect(() => loadRemoteConfig()).toThrow();
  });
});
