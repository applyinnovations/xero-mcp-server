import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, JWTVerifyGetKey } from "jose";
import { AccountingApi, BankTransaction } from "xero-node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createAccessVerifier, loadRemoteConfig, RemoteAuthError, RemoteConfig } from "../../auth/remote-auth.js";
import { TenantXeroClient } from "../../clients/xero-client.js";
import { transaction, accounts, changes } from "../../recoding/__tests__/fixtures.js";
import { createRemoteServer } from "../remote-mcp-server.js";

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const config: RemoteConfig = { accessTokenProfile: "bearer-claim", issuer: "https://keycloak.example.test/realms/fixture", resource: "https://mcp.example.test/mcp", audience: "https://mcp.example.test/mcp", readScope: "xero:read", subjectTenants: new Map([["alice", [tenantA]], ["bob", [tenantB]]]), allowedOrigins: [] };
let privateKey: CryptoKey;
let key: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256"); privateKey = pair.privateKey;
  key = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), alg: "RS256", kid: "fixture", use: "sig" }] });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: config.issuer, aud: config.audience, sub: "alice", iat: now, exp: now + 300, typ: "Bearer", scope: "xero:read", ...overrides }).setProtectedHeader({ alg: "RS256", kid: "fixture", typ: "JWT" }).sign(privateKey);
}
async function listening(configuration = config) {
  const server = createRemoteServer(configuration, key);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  return { server, url, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

describe("Keycloak access verification", () => {
  it("accepts only the configured issuer/audience and subject permissions", async () => {
    expect(await createAccessVerifier(config, key)(await token())).toEqual([tenantA]);
  });
  it.each([
    [{ aud: "other-resource" }, 401], [{ iss: "https://other.example/realm" }, 401],
    [{ exp: 1 }, 401], [{ typ: "ID" }, 401], [{ scope: "" }, 403], [{ sub: "unknown" }, 403],
  ] as const)("rejects invalid claims %j", async (claims, status) => {
    await expect(createAccessVerifier(config, key)(await token(claims))).rejects.toMatchObject<Partial<RemoteAuthError>>({ status });
  });
  it("rejects a valid-looking token signed by an unrelated key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ typ: "Bearer", scope: "xero:read" }).setProtectedHeader({ alg: "RS256", kid: "fixture", typ: "JWT" }).setIssuer(config.issuer).setAudience(config.audience).setSubject("alice").setIssuedAt().setExpirationTime("5m").sign(other.privateKey);
    await expect(createAccessVerifier(config, key)(forged)).rejects.toMatchObject({ status: 401 });
  });
  it("requires HTTPS configuration and an explicit subject allowlist", () => {
    vi.stubEnv("MCP_ISSUER", "http://keycloak.example/realms/test");
    expect(() => loadRemoteConfig()).toThrow("HTTPS");
    vi.stubEnv("MCP_ISSUER", config.issuer);
    vi.stubEnv("MCP_RESOURCE_URL", config.resource);
    vi.stubEnv("MCP_SUBJECT_TENANTS_JSON", "{}");
    expect(() => loadRemoteConfig()).toThrow("explicitly authorize");
  });
});

describe("remote MCP protocol", () => {
  it("provides protected-resource discovery and rejects missing credentials and hostile origins", async () => {
    const endpoint = await listening();
    try {
      const metadata = await fetch(new URL("/.well-known/oauth-protected-resource/mcp", endpoint.url));
      expect(await metadata.json()).toMatchObject({ resource: config.resource, authorization_servers: [config.issuer], scopes_supported: ["xero:read"] });
      const missing = await fetch(endpoint.url, { method: "POST", body: "{}" });
      expect(missing.status).toBe(401);
      expect(missing.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource/mcp");
      const hostile = await fetch(endpoint.url, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, Origin: "https://hostile.example" }, body: "{}" });
      expect(hostile.status).toBe(403);
      const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(endpoint.url, { method: "POST", headers: { Host: "hostile.example" } }, (response) => {
          response.resume(); resolve(response.statusCode);
        });
        request.on("error", reject); request.end("{}");
      });
      expect(wrongHost).toBe(403);
    } finally { await endpoint.close(); }
  });

  it("runs authenticated MCP clients concurrently without crossing subject/tenant permissions", async () => {
    vi.stubEnv("XERO_ALLOWED_TENANT_IDS", `${tenantA},${tenantB}`);
    vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "invalid-fixture-token");
    vi.spyOn(TenantXeroClient.prototype, "authenticate").mockResolvedValue(undefined);
    const get = vi.spyOn(AccountingApi.prototype, "getBankTransactions").mockImplementation(async (tenantId) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { response: {}, body: { bankTransactions: [{ type: BankTransaction.TypeEnum.SPEND, bankTransactionID: tenantId, bankAccount: {}, total: 0, lineItems: [] }] } } as Awaited<ReturnType<AccountingApi["getBankTransactions"]>>;
    });
    const endpoint = await listening();
    const alice = new Client({ name: "alice-fixture", version: "1" });
    const bob = new Client({ name: "bob-fixture", version: "1" });
    try {
      await Promise.all([
        alice.connect(new StreamableHTTPClientTransport(endpoint.url, { requestInit: { headers: { Authorization: `Bearer ${await token()}` } } })),
        bob.connect(new StreamableHTTPClientTransport(endpoint.url, { requestInit: { headers: { Authorization: `Bearer ${await token({ sub: "bob" })}` } } })),
      ]);
      const tools = (await alice.listTools()).tools;
      expect(tools.every((tool) => /^(list|get)-/.test(tool.name))).toBe(true);
      const results = await Promise.all([
        alice.callTool({ name: "list-bank-transactions", arguments: { tenantId: tenantA } }),
        bob.callTool({ name: "list-bank-transactions", arguments: { tenantId: tenantB } }),
      ]);
      expect(results.map((result) => result.structuredContent?.tenantId)).toEqual([tenantA, tenantB]);
      const denied = await alice.callTool({ name: "list-bank-transactions", arguments: { tenantId: tenantB } });
      expect(denied.isError).toBe(true);
      expect(get.mock.calls.map((call) => call[0]).sort()).toEqual([tenantA, tenantB]);
    } finally { await Promise.all([alice.close(), bob.close()]); await endpoint.close(); }
  });
});


it("exposes apply only to the configured owner, client, action scope and tenant, with explicit activation", async () => {
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", `${tenantA},${tenantB}`);
  vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "synthetic-read-token");
  vi.spyOn(TenantXeroClient.prototype, "authenticate").mockResolvedValue(undefined);
  vi.spyOn(AccountingApi.prototype, "getBankTransaction").mockResolvedValue({ body: { bankTransactions: [transaction] }, response: {} } as Awaited<ReturnType<AccountingApi["getBankTransaction"]>>);
  vi.spyOn(AccountingApi.prototype, "getAccounts").mockResolvedValue({ body: { accounts }, response: {} } as Awaited<ReturnType<AccountingApi["getAccounts"]>>);
  const post = vi.spyOn(AccountingApi.prototype, "updateBankTransaction");
  for (const [enabled, claims, allowed] of [
    [true, { azp: "approved-client", scope: "xero:read xero:code" }, true],
    [true, { azp: "approved-client", scope: "xero:read" }, false],
    [true, { azp: "different-client", scope: "xero:read xero:code" }, false],
    [true, { sub: "bob", azp: "approved-client", scope: "xero:read xero:code" }, false],
    [false, { azp: "approved-client", scope: "xero:read xero:code" }, false],
  ] as const) {
    const endpoint = await listening({ ...config, recoding: { tenantId: tenantA, subjects: ["alice"], clientId: "approved-client", scope: "xero:code", enabled, grantMode: "shared" } });
    const client = new Client({ name: "coding-test", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(endpoint.url, { requestInit: { headers: { Authorization: `Bearer ${await token(claims)}` } } }));
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names.includes("apply-bank-recode")).toBe(allowed);
      expect(names.filter(name => !/^(list|get)-/.test(name))).toEqual(allowed ? ["apply-bank-recode"] : []);
      if (allowed) {
        const p = await client.callTool({ name: "get-bank-recode-proposal", arguments: { tenantId: tenantA, bankTransactionId: transaction.bankTransactionID, changes } });
        expect(p.isError).not.toBe(true);
        const denied = await client.callTool({ name: "apply-bank-recode", arguments: { tenantId: tenantB, proposalId: p.structuredContent!.proposalId, approvalHash: p.structuredContent!.approvalHash, confirmed: true } });
        expect(denied.isError).toBe(true);
        const receipt = await client.callTool({ name: "apply-bank-recode", arguments: { tenantId: tenantA, proposalId: p.structuredContent!.proposalId, approvalHash: p.structuredContent!.approvalHash, confirmed: true } });
        // The real current read-only grant cannot become a writer through an MCP action scope.
        expect(receipt.structuredContent).toMatchObject({ outcome: "not-applied", reason: "grant" });
      }
    } finally { await client.close(); await endpoint.close(); }
  }
  expect(post).not.toHaveBeenCalled();
});
