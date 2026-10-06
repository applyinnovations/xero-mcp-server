import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, JWTVerifyGetKey } from "jose";
import { AccountingApi, BankTransaction, XeroClient } from "xero-node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createAccessVerifier, loadRemoteConfig, RemoteAuthError, RemoteConfig } from "../../auth/remote-auth.js";
import { TenantXeroClient } from "../../clients/xero-client.js";
import { DurableOAuthProvider } from "../../auth/oauth-provider.js";
import { transaction, accounts, changes } from "../../handlers/__tests__/bank-coding-fixtures.js";
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
function mockGrant(scope: string) {
  vi.stubEnv("XERO_TOKEN_FILE", "/synthetic/state.json");
  vi.stubEnv("XERO_TOKEN_KEY_FILE", "/synthetic/key");
  vi.stubEnv("XERO_CLIENT_ID", "normal-pkce-app");
  vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", undefined);
  vi.spyOn(DurableOAuthProvider.prototype, "getTokenSet").mockResolvedValue({ access_token: "synthetic", scope });
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


it("selects write tools using verified access and global company policy, and requires normal grant consent", async () => {
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", `${tenantA},${tenantB}`);
  vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenantA]: "read-write" }));
  mockGrant("accounting.banktransactions.read");
  vi.spyOn(AccountingApi.prototype, "getBankTransaction").mockResolvedValue({ body: { bankTransactions: [transaction] }, response: {} } as Awaited<ReturnType<AccountingApi["getBankTransaction"]>>);
  vi.spyOn(AccountingApi.prototype, "getAccounts").mockResolvedValue({ body: { accounts }, response: {} } as Awaited<ReturnType<AccountingApi["getAccounts"]>>);
  const post = vi.spyOn(AccountingApi.prototype, "updateBankTransaction");
  for (const [writable, claims, allowed] of [
    [true, { azp: "approved-client" }, true],
    [true, {}, false],
    [true, { azp: ["invalid-client"] }, false],
    [true, { sub: "bob", azp: "approved-client" }, false],
    [false, { azp: "approved-client" }, false],
  ] as const) {
    vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenantA]: writable ? "read-write" : "read-only", [tenantB]: "read-only" }));
    const endpoint = await listening({ ...config, subjectTenants: new Map([["alice", [tenantA, tenantB]], ["bob", [tenantB]]]) });
    const client = new Client({ name: "coding-test", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(endpoint.url, { requestInit: { headers: { Authorization: `Bearer ${await token(claims)}` } } }));
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names.includes("code-bank-transaction")).toBe(allowed);
      expect(names.filter(name => !/^(list|get)-/.test(name))).toEqual(allowed ? ["code-bank-transaction"] : []);
      if (allowed) {
        const args = { bankTransactionId: transaction.bankTransactionID, changes, idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
        const denied = await client.callTool({ name: "code-bank-transaction", arguments: { tenantId: tenantB, ...args } });
        expect(denied.isError).toBe(true);
        expect(denied.content).toEqual([{ type: "text", text: expect.stringContaining("read-only") }]);
        const receipt = await client.callTool({ name: "code-bank-transaction", arguments: { tenantId: tenantA, ...args } });
        expect(receipt.isError).toBe(true);
        expect(receipt.structuredContent).toMatchObject({ outcome: "not-applied", code: "scope" });
        expect(receipt.structuredContent).not.toHaveProperty("before");
      }
    } finally { await client.close(); await endpoint.close(); }
  }
  expect(post).not.toHaveBeenCalled();
  expect(AccountingApi.prototype.getBankTransaction).not.toHaveBeenCalled();
  expect(AccountingApi.prototype.getAccounts).not.toHaveBeenCalled();
});


it("performs a direct coding call through signed-user request registration without approval state", async () => {
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenantA);
  vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenantA]: "read-write" }));
  mockGrant("accounting.banktransactions");
  let record = structuredClone(transaction);
  vi.spyOn(XeroClient.prototype, "updateTenants").mockImplementation(async function () {
    Object.defineProperty(this, "tenants", { value: [{ tenantId: tenantA }] });
    return this.tenants;
  });
  vi.spyOn(AccountingApi.prototype, "getBankTransaction").mockImplementation(async () => ({ body: { bankTransactions: [structuredClone(record)] }, response: {} }) as Awaited<ReturnType<AccountingApi["getBankTransaction"]>>);
  vi.spyOn(AccountingApi.prototype, "getAccounts").mockResolvedValue({ body: { accounts }, response: {} } as Awaited<ReturnType<AccountingApi["getAccounts"]>>);
  const post = vi.spyOn(AccountingApi.prototype, "updateBankTransaction").mockImplementation(async (...args) => {
    record.lineItems = structuredClone(args[2].bankTransactions![0].lineItems);
    return { body: { bankTransactions: [record] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>;
  });
  const endpoint = await listening();
  const client = new Client({ name: "direct-coding-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint.url, { requestInit: { headers: { Authorization: `Bearer ${await token({ azp: "approved-client" })}` } } }));
    const tools = (await client.listTools()).tools;
    expect(tools.some(tool => /proposal|apply-bank/.test(tool.name))).toBe(false);
    const coding = tools.find(tool => tool.name === "code-bank-transaction")!;
    expect(coding.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(Object.keys(coding.inputSchema.properties!)).toEqual(expect.arrayContaining(["tenantId", "bankTransactionId", "changes", "idempotencyKey", "expectedUpdatedDateUTC"]));
    const args = { tenantId: tenantA, bankTransactionId: transaction.bankTransactionID, changes, idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
    const result = await client.callTool({ name: "code-bank-transaction", arguments: args });
    expect(result, JSON.stringify(result)).toMatchObject({ isError: false });
    expect(result.structuredContent).toMatchObject({ outcome: "updated", actor: "alice", preservationVerified: true, statementLinkageVerified: false });
    expect(result.structuredContent).not.toHaveProperty("before"); expect(result.structuredContent).not.toHaveProperty("after");
    post.mockRejectedValueOnce({ response: { statusCode: 403 } });
    record = structuredClone(transaction);
    const rejected = await client.callTool({ name: "code-bank-transaction", arguments: { ...args, idempotencyKey: "ffffffff-ffff-4fff-8fff-ffffffffffff" } });
    expect(rejected.isError).toBe(true); expect(rejected.structuredContent).toMatchObject({ outcome: "rejected", httpStatus: 403 });
  } finally { await client.close(); await endpoint.close(); }
});
