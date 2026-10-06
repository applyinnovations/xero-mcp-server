import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, readFile, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, JWTVerifyGetKey } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DurableOAuthProvider } from "../oauth-provider.js";
import { EncryptedTokenStore } from "../token-store.js";
import { XeroOnboarding } from "../xero-onboarding.js";
import { configuredXeroScopes, onboardingScopes, exchangeXeroCode, getXeroConnections } from "../xero-authorization.js";
import { RemoteConfig, loadRemoteConfig } from "../remote-auth.js";
import { createRemoteServer } from "../../server/remote-mcp-server.js";

const origin = "https://mcp.example.test";
const clientId = "synthetic-xero-client";
const tenants = [1, 2, 3].map(n => `${String(n).repeat(8)}-1111-4111-8111-111111111111`);
const connections = tenants.map((tenantId, i) => ({ tenantId, tenantType: "ORGANISATION", tenantName: `Fixture organisation ${i + 1}` }));
const config: RemoteConfig = { issuer: "https://issuer.example.test/realm", resource: `${origin}/mcp`, audience: `${origin}/mcp`,
  accessTokenProfile: "bearer-claim", readScope: "xero:read", subjectTenants: new Map(), allowedOrigins: [],
  connectSubjects: ["owner"], connectScope: "xero:connect", connectClientId: "fixture-mcp-client" };
let directory: string; let statePath: string; let store: EncryptedTokenStore;
let key: JWTVerifyGetKey; let privateKey: CryptoKey;
let now: number; let round: number; let xeroSubject: string; let connectionOverride: unknown;
let grantedScopes: readonly string[];
let request: ReturnType<typeof vi.fn<typeof fetch>>;
const closing: (() => Promise<void>)[] = [];
function issuedToken(subject = "fixture-xero-user", scopes: readonly string[] = onboardingScopes) {
  return `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({
    iss: "https://identity.xero.com", client_id: clientId, sub: subject, scope: scopes, round,
  })).toString("base64url")}.synthetic-signature`;
}
beforeAll(async () => {
  const pair = await generateKeyPair("RS256"); privateKey = pair.privateKey;
  key = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "fixture", alg: "RS256" }] });
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "xero-hosted-fixture-")); statePath = join(directory, "state.json");
  const keyPath = join(directory, "key");
  await writeFile(keyPath, Buffer.alloc(32, 7).toString("base64"), { mode: 0o600 });
  store = new EncryptedTokenStore(statePath, keyPath, clientId);
  now = 1000000; round = 0; xeroSubject = "fixture-xero-user"; connectionOverride = undefined; grantedScopes = onboardingScopes;
  vi.stubEnv("MCP_TRANSPORT", "http"); vi.stubEnv("XERO_ONBOARDING_ENABLED", "true"); vi.stubEnv("XERO_ALLOWED_TENANT_IDS", "");
  request = vi.fn(async (input, options) => {
    expect(options?.redirect).toBe("error"); expect(options?.signal).toBeDefined();
    if (input === "https://identity.xero.com/connect/token") {
      round++;
      const body = options?.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_id")).toBe(clientId); expect(body.get("redirect_uri")).toBe(`${origin}/xero/callback`);
      expect(body.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
      expect(options?.headers).not.toHaveProperty("Authorization");
      return new Response(JSON.stringify({ access_token: issuedToken(xeroSubject, grantedScopes), refresh_token: `invalid-fixture-refresh-${round}`,
        expires_in: 1800, token_type: "Bearer", scope: grantedScopes.join(" ") }));
    }
    expect(input).toBe("https://api.xero.com/connections");
    return new Response(JSON.stringify(connectionOverride ?? connections.slice(0, round)));
  });
});
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
  await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
async function endpoint(allowedTenantIds: string[] = [], scopes?: readonly string[], selectedStore = store) {
  const onboarding = new XeroOnboarding({ origin, clientId, store: selectedStore, allowedTenantIds, scopes, fetcher: request, now: () => now });
  const server = createRemoteServer(config, key, onboarding);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closing.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const call = (path: string, options: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    // Node fetch controls Host; use the native client to exercise the same Host
    // the HTTPS ingress forwards in production, while listening on loopback.
    const outgoing = httpRequest(base + path, { method: options.method ?? "GET",
      headers: { Host: "mcp.example.test", ...options.headers } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk)); response.on("error", reject);
      response.on("end", () => {
        const headers = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
      });
    });
    outgoing.on("error", reject); outgoing.end(typeof options.body === "string" ? options.body : undefined);
  });
  return { onboarding, base, call };
}
type Endpoint = Awaited<ReturnType<typeof endpoint>>;
async function launch(web: Endpoint, link: { startUrl: string }, scopes: readonly string[] = onboardingScopes) {
  const ticket = new URLSearchParams(new URL(link.startUrl).hash.slice(1)).get("ticket");
  const response = await web.call("/xero/start", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ ticket }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("Set-Cookie")).toContain("Secure; HttpOnly; SameSite=Lax; Path=/");
  const authorization = new URL((await response.json()).authorizationUrl);
  expect(authorization.origin).toBe("https://login.xero.com");
  expect(authorization.searchParams.get("scope")).toBe(scopes.join(" "));
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorization.searchParams.get("redirect_uri")).toBe(`${origin}/xero/callback`);
  return { authorization, cookie: response.headers.get("Set-Cookie")!.split(";")[0], ticket };
}
async function callback(web: Endpoint, launchResult: Awaited<ReturnType<typeof launch>>) {
  const query = new URLSearchParams({ code: "invalid-synthetic-code", state: launchResult.authorization.searchParams.get("state")! });
  const response = await web.call(`/xero/callback?${query}`, { headers: { Cookie: launchResult.cookie } });
  expect(response.status).toBe(303); expect(response.headers.get("Location")).toBe(`${origin}/xero/result`);
  const exchange = request.mock.calls.findLast(call => call[0] === "https://identity.xero.com/connect/token");
  if (exchange) {
    const verifier = (exchange[1]?.body as URLSearchParams).get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(launchResult.authorization.searchParams.get("code_challenge"));
  }
}
async function jwt(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ typ: "Bearer", scope: "xero:connect", azp: "fixture-mcp-client", ...overrides })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "fixture" }).setIssuer(config.issuer).setAudience(config.audience)
    .setSubject(typeof overrides.sub === "string" ? overrides.sub : "owner").setIssuedAt().setExpirationTime("5m").sign(privateKey);
}

describe("hosted PKCE onboarding", () => {
  it("connects three organisations sequentially and persists only the final owner-confirmed grant", async () => {
    const web = await endpoint(); let link = await web.onboarding.begin("owner");
    for (let n = 1; n <= 3; n++) {
      await callback(web, await launch(web, link));
      expect(web.onboarding.status("owner", link.transactionId).connections).toHaveLength(n);
      expect(await store.hasState()).toBe(false);
      if (n < 3) link = web.onboarding.next("owner", link.transactionId);
    }
    expect(JSON.stringify(web.onboarding.status("owner", link.transactionId))).not.toContain("refresh_token");
    await expect(web.onboarding.confirm("other", link.transactionId, tenants)).rejects.toThrow();
    await expect(web.onboarding.confirm("owner", link.transactionId, [tenants[0], tenants[0], tenants[2]])).rejects.toThrow();
    expect((await web.onboarding.confirm("owner", link.transactionId, tenants)).phase).toBe("complete");
    expect((await store.read()).refresh_token).toBe("invalid-fixture-refresh-3");
    const disk = await readFile(statePath, "utf8"); expect(disk).not.toContain("invalid-fixture-refresh"); expect(disk).not.toContain("access_token");
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    await expect(web.onboarding.begin("owner")).rejects.toThrow();
  });

  it.each([1, 2])("confirms an owner-selected set of %i organisations without an expected count", async count => {
    const web = await endpoint(); let link = await web.onboarding.begin("owner");
    for (let n = 1; n <= count; n++) {
      await callback(web, await launch(web, link));
      if (n < count) link = web.onboarding.next("owner", link.transactionId);
    }
    expect(web.onboarding.status("owner", link.transactionId)).not.toHaveProperty("expectedCount");
    await expect(web.onboarding.confirm("owner", link.transactionId, [])).rejects.toThrow();
    await expect(web.onboarding.confirm("owner", link.transactionId, tenants.slice(0, count + 1))).rejects.toThrow();
    expect(await store.hasState()).toBe(false);
    expect((await web.onboarding.confirm("owner", link.transactionId, tenants.slice(0, count))).phase).toBe("complete");
  });

  it("rejects stolen state without browser binding, duplicates, replay and cross-origin launch", async () => {
    const web = await endpoint(); const link = await web.onboarding.begin("owner");
    const ticket = new URL(link.startUrl).hash.slice(8);
    expect((await web.call("/xero/start", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ ticket }) })).status).toBe(400);
    const first = await launch(web, link);
    expect((await web.call("/xero/start", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ ticket: first.ticket }) })).status).toBe(400);
    const state = first.authorization.searchParams.get("state");
    expect((await web.call(`/xero/callback?state=${state}&code=invalid`)).status).toBe(400);
    expect((await web.call(`/xero/callback?state=wrong&code=invalid`, { headers: { Cookie: first.cookie } })).status).toBe(400);
    expect((await web.call(`/xero/callback?state=${state}&state=${state}&code=invalid`, { headers: { Cookie: first.cookie } })).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
    await callback(web, first);
    const beforeReplay = request.mock.calls.length;
    expect((await web.call(`/xero/callback?state=${state}&code=invalid`, { headers: { Cookie: first.cookie } })).status).toBe(400);
    expect(request.mock.calls.length).toBe(beforeReplay);
  });

  it("expires launch capabilities, refuses concurrent starts and serves no secrets in landing pages", async () => {
    const web = await endpoint(); const link = await web.onboarding.begin("owner");
    await expect(web.onboarding.begin("owner")).rejects.toThrow();
    const page = await web.call("/xero/start"); const html = await page.text();
    expect(page.headers.get("Content-Security-Policy")).toContain("script-src 'nonce-"); expect(html).not.toContain(clientId);
    expect(html).toContain("history.replaceState"); expect(html).not.toContain(new URL(link.startUrl).hash.slice(8));
    now += 300001;
    await expect(launch(web, link)).rejects.toThrow();
    const retry = web.onboarding.next("owner", link.transactionId);
    expect(retry.startUrl).not.toBe(link.startUrl);
    now += 900001;
    expect(() => web.onboarding.status("owner", link.transactionId)).toThrow();
    expect((await web.call("/xero/result")).status).toBe(200);
  });

  it("rejects account switching, lost connections, unauthorized tenants and permission changes before save", async () => {
    const web = await endpoint(tenants); const link = await web.onboarding.begin("owner");
    await callback(web, await launch(web, link));
    xeroSubject = "other-xero-user";
    await callback(web, await launch(web, web.onboarding.next("owner", link.transactionId)));
    expect(web.onboarding.status("owner", link.transactionId).phase).toBe("failed"); expect(await store.hasState()).toBe(false);
    xeroSubject = "fixture-xero-user"; connectionOverride = [connections[1]];
    await callback(web, await launch(web, web.onboarding.next("owner", link.transactionId)));
    expect(web.onboarding.status("owner", link.transactionId).phase).toBe("failed");
    connectionOverride = [...connections, { ...connections[0], tenantId: "44444444-1111-4111-8111-111111111111" }];
    await callback(web, await launch(web, web.onboarding.next("owner", link.transactionId)));
    expect(web.onboarding.status("owner", link.transactionId).phase).toBe("failed");
    connectionOverride = connections;
    await callback(web, await launch(web, web.onboarding.next("owner", link.transactionId)));
    connectionOverride = connections.slice(0, 2);
    await expect(web.onboarding.confirm("owner", link.transactionId, tenants)).rejects.toThrow();
    expect(await store.hasState()).toBe(false);
  });

  it("handles denial and failed token responses without reflecting codes, descriptions or credentials", async () => {
    const web = await endpoint(); const link = await web.onboarding.begin("owner"); const first = await launch(web, link);
    const result = await web.call(`/xero/callback?state=${first.authorization.searchParams.get("state")}&error=access_denied&error_description=private-detail`, { headers: { Cookie: first.cookie } });
    expect(result.status).toBe(303); expect(await result.text()).not.toContain("private-detail"); expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(new Response("private response with invalid-secret", { status: 400 }));
    await callback(web, await launch(web, web.onboarding.next("owner", link.transactionId)));
    expect(web.onboarding.status("owner", link.transactionId).phase).toBe("failed"); expect(await store.hasState()).toBe(false);
  });

  it("refuses weak keys and only renews a revoked marker with the previously configured tenant set", async () => {
    const web = await endpoint(tenants);
    await chmod(join(directory, "key"), 0o644);
    await expect(web.onboarding.begin("owner")).rejects.toThrow();
    await chmod(join(directory, "key"), 0o600);
    await store.initialize({ access_token: "invalid-old", refresh_token: "invalid-old", expires_at: 1 });
    await expect(web.onboarding.begin("owner", { renewRevokedGrant: true })).rejects.toThrow();
    await store.withLock(() => store.write({ access_token: "invalid-old", refresh_token: "invalid-old", expires_at: 1, reauthorizeRequired: true }));
    await expect(web.onboarding.begin("owner")).rejects.toThrow();
    let link = await web.onboarding.begin("owner", { renewRevokedGrant: true });
    for (let n = 1; n <= 3; n++) { await callback(web, await launch(web, link)); if (n < 3) link = web.onboarding.next("owner", link.transactionId); }
    expect((await web.onboarding.confirm("owner", link.transactionId, tenants)).phase).toBe("complete");
    expect((await store.read()).reauthorizeRequired).toBeUndefined();
  });

  it("rejects unexpected write scopes, redirected or oversized token responses", async () => {
    const response = { access_token: issuedToken("fixture", [...onboardingScopes, "accounting.banktransactions"]), refresh_token: "invalid", expires_in: 1800, token_type: "Bearer" };
    const fake = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response)));
    await expect(exchangeXeroCode(clientId, `${origin}/xero/callback`, "invalid", "invalid", fake)).rejects.toThrow();
    fake.mockImplementation(async () => new Response("x".repeat(65537)));
    await expect(exchangeXeroCode(clientId, `${origin}/xero/callback`, "invalid", "invalid", fake)).rejects.toThrow("Oversized");
    await expect(getXeroConnections("invalid", fake)).rejects.toThrow("Oversized");
    fake.mockResolvedValue(new Response("", { status: 302 }));
    await expect(exchangeXeroCode(clientId, `${origin}/xero/callback`, "invalid", "invalid", fake)).rejects.toThrow();
  });
});

async function healthyGrant() {
  const tokens = { access_token: issuedToken(), refresh_token: "invalid-existing-refresh", expires_at: 9999999999,
    scope: onboardingScopes.join(" ") };
  await store.initialize(tokens);
  return { tokens: await store.read(), disk: await readFile(statePath, "utf8") };
}

// No feature-specific consent branch: the same configured scope path covers
// unrelated API resources, and only the operator controls that configuration.
describe("configured OAuth renewal", () => {
  it("validates the existing app-wide setting, defaults to reads, and requires offline access", () => {
    vi.stubEnv("XERO_SCOPES", "offline_access  accounting.contacts.read\naccounting.contacts.read");
    expect(configuredXeroScopes()).toEqual(["offline_access", "accounting.contacts.read"]);
    for (const invalid of ["", "accounting.contacts", "offline_access invalid?scope"]) {
      vi.stubEnv("XERO_SCOPES", invalid); expect(() => configuredXeroScopes()).toThrow();
    }
    delete process.env.XERO_SCOPES;
    expect(configuredXeroScopes()).toEqual(onboardingScopes);
  });

  it("uses configured generic scopes for initial consent and captures them before browser launch", async () => {
    const scopes = ["offline_access", "accounting.contacts.read"];
    vi.stubEnv("XERO_SCOPES", scopes.join(" ")); grantedScopes = scopes;
    const web = await endpoint();
    vi.stubEnv("XERO_SCOPES", "offline_access accounting.invoices");
    const link = await web.onboarding.begin("owner");
    expect(link.requestedScopes).toEqual(scopes); expect(link.renewingGrant).toBe(false);
    await callback(web, await launch(web, link, scopes));
    expect(web.onboarding.status("owner", link.transactionId).grantedScopes).toEqual(scopes);
    await web.onboarding.confirm("owner", link.transactionId, tenants.slice(0, 1));
    expect((await store.read()).scope).toBe(scopes.join(" "));
  });

  it.each(["accounting.contacts", "accounting.invoices", "accounting.banktransactions"])("renews the same healthy grant for approved %s consent only after owner confirmation", async scope => {
    const previous = await healthyGrant();
    const scopes = [...onboardingScopes, scope]; grantedScopes = scopes; connectionOverride = connections;
    const web = await endpoint(tenants, scopes);
    await expect(web.onboarding.begin("owner")).rejects.toThrow();
    await expect(web.onboarding.begin("owner", { renewRevokedGrant: true })).rejects.toThrow();
    await expect(web.onboarding.begin("owner", { renewGrant: true, renewRevokedGrant: true })).rejects.toThrow();
    const link = await web.onboarding.begin("owner", { renewGrant: true });
    expect(request).not.toHaveBeenCalled(); expect(link.requestedScopes).toEqual(scopes); expect(link.renewingGrant).toBe(true);
    expect(await readFile(statePath, "utf8")).toBe(previous.disk);
    await callback(web, await launch(web, link, scopes));
    expect(web.onboarding.status("owner", link.transactionId)).toMatchObject({ phase: "review", grantedScopes: scopes });
    expect(await readFile(statePath, "utf8")).toBe(previous.disk);
    await expect(web.onboarding.confirm("other", link.transactionId, tenants)).rejects.toThrow();
    await expect(web.onboarding.confirm("owner", link.transactionId, tenants.slice(0, 2))).rejects.toThrow();
    expect((await web.onboarding.confirm("owner", link.transactionId, tenants)).phase).toBe("complete");
    expect((await store.read()).scope).toBe(scopes.join(" "));
    expect((await store.read()).refresh_token).toBe("invalid-fixture-refresh-1");
    expect(JSON.stringify(web.onboarding.status("owner", link.transactionId))).not.toContain("refresh_token");
    await expect(web.onboarding.begin("owner")).rejects.toThrow();
  });

  it("refuses an empty existing state, absent configured tenants, scope loss or unbound stored identity", async () => {
    const web = await endpoint(tenants);
    await expect(web.onboarding.begin("owner", { renewGrant: true })).rejects.toThrow();
    const previous = await healthyGrant();
    await expect((await endpoint()).onboarding.begin("owner", { renewGrant: true })).rejects.toThrow();
    await expect((await endpoint(tenants, ["offline_access", "accounting.contacts"])).onboarding.begin("owner", { renewGrant: true })).rejects.toThrow();
    await store.withLock(() => store.write({ ...previous.tokens, scope: undefined }));
    await expect(web.onboarding.begin("owner", { renewGrant: true })).rejects.toThrow();
    await store.withLock(() => store.write({ ...previous.tokens, access_token: "invalid-import-without-identity" }));
    await expect(web.onboarding.begin("owner", { renewGrant: true })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["denial", "exchange", "scope", "account", "tenants", "extra tenant", "expiry"])("preserves encrypted existing state after renewal %s failure", async failure => {
    const previous = await healthyGrant();
    const scopes = [...onboardingScopes, "accounting.contacts"]; grantedScopes = scopes; connectionOverride = connections;
    const web = await endpoint(tenants, scopes);
    const link = await web.onboarding.begin("owner", { renewGrant: true });
    const first = await launch(web, link, scopes);
    if (failure === "denial") {
      await web.call(`/xero/callback?state=${first.authorization.searchParams.get("state")}&error=access_denied`, { headers: { Cookie: first.cookie } });
    } else if (failure === "expiry") {
      now += 900001;
      await expect(web.onboarding.confirm("owner", link.transactionId, tenants)).rejects.toThrow();
    } else {
      if (failure === "exchange") request.mockResolvedValueOnce(new Response("invalid-secret", { status: 400 }));
      if (failure === "scope") grantedScopes = [...scopes, "accounting.invoices"];
      if (failure === "account") xeroSubject = "different-xero-user";
      if (failure === "tenants") connectionOverride = connections.slice(0, 2);
      if (failure === "extra tenant") connectionOverride = [...connections, { ...connections[0], tenantId: "44444444-1111-4111-8111-111111111111" }];
      await callback(web, first);
      await expect(web.onboarding.confirm("owner", link.transactionId, tenants)).rejects.toThrow();
    }
    expect(await readFile(statePath, "utf8")).toBe(previous.disk);
    expect(await store.read()).toEqual(previous.tokens);
  });

  it("preserves existing state on persistence failure and rechecks connections at confirmation", async () => {
    const previous = await healthyGrant(); const scopes = [...onboardingScopes, "accounting.contacts"];
    grantedScopes = scopes; connectionOverride = connections;
    const web = await endpoint(tenants, scopes); const link = await web.onboarding.begin("owner", { renewGrant: true });
    await callback(web, await launch(web, link, scopes));
    connectionOverride = connections.slice(0, 2);
    await expect(web.onboarding.confirm("owner", link.transactionId, tenants)).rejects.toThrow();
    expect(await readFile(statePath, "utf8")).toBe(previous.disk);
    connectionOverride = connections;
    await callback(web, await launch(web, web.onboarding.next("owner", link.transactionId), scopes));
    expect(web.onboarding.status("owner", link.transactionId).phase).toBe("review");
    const persist = vi.spyOn(store, "write").mockRejectedValueOnce(new Error("synthetic persistence failure"));
    await expect(web.onboarding.confirm("owner", link.transactionId, tenants)).rejects.toThrow();
    expect(await readFile(statePath, "utf8")).toBe(previous.disk);
    expect(persist).toHaveBeenCalledOnce();
    expect(web.onboarding.status("owner", link.transactionId)).toMatchObject({ phase: "failed", grantedScopes: undefined });
  });

  it.each(["account", "scope"])("refuses replacement after existing grant %s changes while consent is in progress", async change => {
    const previous = await healthyGrant(); const scopes = [...onboardingScopes, "accounting.contacts"];
    grantedScopes = scopes; connectionOverride = connections;
    const web = await endpoint(tenants, scopes); const link = await web.onboarding.begin("owner", { renewGrant: true });
    await callback(web, await launch(web, link, scopes));
    const updated = change === "account" ? { ...previous.tokens, access_token: issuedToken("different-user") }
      : { ...previous.tokens, scope: "offline_access" };
    await store.withLock(() => store.write(updated)); const disk = await readFile(statePath, "utf8");
    await expect(web.onboarding.confirm("owner", link.transactionId, tenants)).rejects.toThrow();
    expect(await readFile(statePath, "utf8")).toBe(disk);
  });

  it.each([false, true])("rejects older same-account/scope/tenant renewal after a newer consent replaces the shared grant (legacy=%s)", async legacy => {
    const previous = await healthyGrant();
    if (legacy) await store.withLock(() => store.write({ ...previous.tokens, grantRevision: undefined }));
    const original = await store.read(); connectionOverride = connections;
    // Separate store objects and onboarding instances simulate concurrent processes.
    const secondStore = new EncryptedTokenStore(statePath, join(directory, "key"), clientId);
    const older = await endpoint(tenants); const newer = await endpoint(tenants, undefined, secondStore);
    const [oldLink, newLink] = await Promise.all([
      older.onboarding.begin("owner", { renewGrant: true }), newer.onboarding.begin("owner", { renewGrant: true }),
    ]);
    await callback(older, await launch(older, oldLink));
    await callback(newer, await launch(newer, newLink));
    expect((await newer.onboarding.confirm("owner", newLink.transactionId, tenants)).phase).toBe("complete");
    const replacement = await secondStore.read(); const disk = await readFile(statePath, "utf8");
    expect(replacement.grantRevision).toBeDefined(); expect(replacement.grantRevision).not.toBe(original.grantRevision);
    expect(replacement.scope).toBe(original.scope); expect(replacement.refresh_token).toBe("invalid-fixture-refresh-2");
    await expect(older.onboarding.confirm("owner", oldLink.transactionId, tenants)).rejects.toThrow();
    expect(older.onboarding.status("owner", oldLink.transactionId).phase).toBe("failed");
    expect(await secondStore.read()).toEqual(replacement); expect(await readFile(statePath, "utf8")).toBe(disk);
  });

  it.each([false, true])("accepts actual provider refresh rotation while retaining the same grant revision (legacy=%s)", async legacy => {
    const previous = await healthyGrant(); const scopes = [...onboardingScopes, "accounting.contacts"];
    if (legacy) await store.withLock(() => store.write({ ...previous.tokens, grantRevision: undefined }));
    const original = await store.read(); grantedScopes = scopes; connectionOverride = connections;
    const web = await endpoint(tenants, scopes); const link = await web.onboarding.begin("owner", { renewGrant: true });
    await callback(web, await launch(web, link, scopes));
    const refresh = vi.fn<typeof fetch>(async (_input, options) => {
      expect((options?.body as URLSearchParams).get("refresh_token")).toBe(original.refresh_token);
      return new Response(JSON.stringify({ access_token: issuedToken(), refresh_token: "invalid-rotated-refresh",
        expires_in: 1800, token_type: "Bearer", scope: [...onboardingScopes].reverse().join(" ") }));
    });
    const provider = new DurableOAuthProvider({ store: new EncryptedTokenStore(statePath, join(directory, "key"), clientId),
      clientId, request: refresh, now: () => original.expires_at * 1000 });
    const sdkTokens = await provider.getTokenSet(); const rotated = await store.read();
    expect(refresh).toHaveBeenCalledOnce(); expect(rotated.refresh_token).toBe("invalid-rotated-refresh");
    expect(rotated.grantRevision).toBe(original.grantRevision); expect(sdkTokens).not.toHaveProperty("grantRevision");
    expect((await web.onboarding.confirm("owner", link.transactionId, tenants)).phase).toBe("complete");
    const confirmed = await store.read(); expect(confirmed.scope).toBe(scopes.join(" "));
    expect(confirmed.grantRevision).not.toBe(original.grantRevision);
  });
});

describe("onboarding MCP authorization", () => {
  it("requires owner/client/scope/access profile and confirms six organisations through the four MCP tools", async () => {
    const web = await endpoint();
    for (const claims of [{ sub: "other" }, { scope: "xero:read" }, { azp: "other-client" }, { typ: "ID" }]) {
      const rejected = new Client({ name: "rejected", version: "1" });
      await expect(rejected.connect(new StreamableHTTPClientTransport(new URL(`${web.base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${await jwt(claims)}` } },
      }))).rejects.toThrow(); await rejected.close();
    }
    const owner = new Client({ name: "owner", version: "1" });
    try {
      await owner.connect(new StreamableHTTPClientTransport(new URL(`${web.base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${await jwt()}` } } }));
      expect((await owner.listTools()).tools.map(tool => tool.name).sort()).toEqual([
        "begin-xero-connection", "confirm-xero-connection", "continue-xero-connection", "get-xero-connection-status",
      ]);
      const result = await owner.callTool({ name: "begin-xero-connection", arguments: {} });
      expect(result.structuredContent?.startUrl).toMatch(/^https:\/\/mcp.example.test\/xero\/start#ticket=/);
      expect(request).not.toHaveBeenCalled(); expect(await store.hasState()).toBe(false);
      let link = result.structuredContent as { transactionId: string; startUrl: string };
      const selectedConnections = Array.from({ length: 6 }, (_, n) => ({
        tenantId: `${(n + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
        tenantType: "ORGANISATION", tenantName: `Additional fixture ${n + 1}`,
      }));
      for (let n = 1; n <= selectedConnections.length; n++) {
        connectionOverride = selectedConnections.slice(0, n);
        await callback(web, await launch(web, link));
        const status = await owner.callTool({ name: "get-xero-connection-status", arguments: { transactionId: link.transactionId } });
        expect(status.structuredContent?.connections).toHaveLength(n);
        if (n < selectedConnections.length) {
          const next = await owner.callTool({ name: "continue-xero-connection", arguments: { transactionId: link.transactionId } });
          link = next.structuredContent as { transactionId: string; startUrl: string };
        }
      }
      const saved = await owner.callTool({ name: "confirm-xero-connection", arguments: { transactionId: link.transactionId, tenantIds: selectedConnections.map(connection => connection.tenantId), confirmed: true } });
      expect(saved.structuredContent?.phase).toBe("complete");
      expect((await store.read()).refresh_token).toBe("invalid-fixture-refresh-6");
    } finally { await owner.close(); }
  });
  it("renews through the existing owner-authorized MCP tools without caller-selected scopes", async () => {
    const previous = await healthyGrant(); const scopes = [...onboardingScopes, "accounting.contacts"];
    grantedScopes = scopes; connectionOverride = connections;
    const web = await endpoint(tenants, scopes); const owner = new Client({ name: "owner", version: "1" });
    try {
      await owner.connect(new StreamableHTTPClientTransport(new URL(`${web.base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${await jwt()}` } } }));
      const tools = (await owner.listTools()).tools;
      const begin = tools.find(tool => tool.name === "begin-xero-connection")!;
      expect(begin.inputSchema.properties).toHaveProperty("renewGrant");
      expect(begin.inputSchema.properties).not.toHaveProperty("scopes");
      expect((await owner.callTool({ name: begin.name, arguments: {} })).isError).toBe(true);
      const result = await owner.callTool({ name: begin.name, arguments: { renewGrant: true } });
      expect(result.isError).not.toBe(true); expect(result.structuredContent?.requestedScopes).toEqual(scopes);
      expect(request).not.toHaveBeenCalled(); expect(await readFile(statePath, "utf8")).toBe(previous.disk);
      const link = result.structuredContent as { transactionId: string; startUrl: string };
      await callback(web, await launch(web, link, scopes));
      const review = await owner.callTool({ name: "get-xero-connection-status", arguments: { transactionId: link.transactionId } });
      expect(review.structuredContent).toMatchObject({ phase: "review", grantedScopes: scopes, connections });
      expect(await readFile(statePath, "utf8")).toBe(previous.disk);
      const saved = await owner.callTool({ name: "confirm-xero-connection", arguments: { transactionId: link.transactionId, tenantIds: tenants, confirmed: true } });
      expect(saved.isError).not.toBe(true); expect(saved.structuredContent?.phase).toBe("complete");
      expect((await store.read()).scope).toBe(scopes.join(" "));
    } finally { await owner.close(); }
  });
  it("permits an empty read mapping only with explicit owner onboarding configuration", () => {
    vi.stubEnv("MCP_ISSUER", config.issuer); vi.stubEnv("MCP_RESOURCE_URL", config.resource);
    vi.stubEnv("MCP_SUBJECT_TENANTS_JSON", "{}"); vi.stubEnv("MCP_CONNECT_SUBJECTS_JSON", '["owner"]');
    vi.stubEnv("MCP_CONNECT_CLIENT_ID", "fixture-mcp-client");
    expect(loadRemoteConfig().subjectTenants.size).toBe(0);
    vi.stubEnv("MCP_CONNECT_SUBJECTS_JSON", "[]"); expect(() => loadRemoteConfig()).toThrow();
  });
});
