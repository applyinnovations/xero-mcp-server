import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, link, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as clients from "../../clients/xero-client.js";
import { BankCodingConfig, canCodeBankTransactions, createBankCodingClientFactory, loadBankCodingConfig } from "../bank-coding.js";
import { DurableOAuthProvider } from "../oauth-provider.js";
import { tenantId, others } from "../../handlers/__tests__/bank-coding-fixtures.js";
const config: BankCodingConfig = { subjects: ["owner"], clientId: "client", scope: "xero:code", enabled: true, grantMode: "shared" };
let directory: string;
const write = (callback: () => Promise<clients.TenantXeroClient>) => clients.runWithTenantPermissions([tenantId, ...others], callback, [tenantId]);
beforeEach(async () => {
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", [tenantId, ...others].join(","));
  vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenantId]: "read-write", [others[0]]: "read-only", [others[1]]: "read-only" }));
  directory = await mkdtemp(join(tmpdir(), "coding-auth-")); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

it("keeps activation disabled by default and requires shared company policy, action policy and grant choice", () => {
  vi.stubEnv("XERO_RECODING_ENABLED", "false"); expect(loadBankCodingConfig({}, "xero:read")).toBeUndefined();
  vi.stubEnv("XERO_RECODING_ENABLED", "true");
  vi.stubEnv("MCP_RECODE_SUBJECTS_JSON", '["owner"]'); vi.stubEnv("MCP_RECODE_CLIENT_ID", "client"); vi.stubEnv("XERO_RECODING_GRANT_MODE", "shared");
  expect(loadBankCodingConfig({ owner: [tenantId] }, "xero:read")).toEqual(config);
  vi.stubEnv("XERO_RECODING_GRANT_MODE", ""); expect(() => loadBankCodingConfig({ owner: [tenantId] }, "xero:read")).toThrow();
  vi.stubEnv("XERO_RECODING_GRANT_MODE", "shared");
  expect(() => loadBankCodingConfig({ owner: others }, "xero:read")).toThrow("read permission");
  vi.stubEnv("MCP_RECODE_SCOPE", "xero:read"); expect(() => loadBankCodingConfig({ owner: [tenantId] }, "xero:read")).toThrow("separate action");
  vi.stubEnv("MCP_RECODE_SCOPE", "xero:code"); vi.stubEnv("XERO_TENANT_ACCESS_JSON", "{}");
  expect(() => loadBankCodingConfig({ owner: [tenantId, ...others] }, "xero:read")).toThrow();
});

it("requires read access and action scope for the exact configured user, client and tenant", () => {
  const access = { subject: "owner", clientId: "client", tenantIds: [tenantId], scopes: ["xero:read", "xero:code"] };
  expect(canCodeBankTransactions(config, access, "xero:read")).toBe(true);
  for (const override of [{ subject: "other" }, { clientId: "other" }, { tenantIds: others }, { scopes: ["xero:read"] }, { scopes: ["xero:code"] }]) expect(canCodeBankTransactions(config, { ...access, ...override }, "xero:read")).toBe(false);
  expect(canCodeBankTransactions({ ...config, enabled: false }, access, "xero:read")).toBe(false);
});

it("checks shared grant tenant and actual Xero consent scope before providing a writer", async () => {
  let scope = "accounting.banktransactions.read";
  const tokens = vi.fn(async () => ({ scope, access_token: "synthetic" }));
  vi.spyOn(clients, "configuredTokenProvider").mockReturnValue({ getTokenSet: tokens });
  const authenticate = vi.spyOn(clients.TenantXeroClient.prototype, "authenticate").mockResolvedValue(undefined);
  const factory = createBankCodingClientFactory(config);
  for (const id of others) await expect(write(() => factory(id))).rejects.toThrow("read-only");
  expect(tokens).not.toHaveBeenCalled();
  await expect(write(() => factory(tenantId))).rejects.toThrow("consent"); expect(authenticate).not.toHaveBeenCalled();
  scope = "accounting.banktransactions"; expect((await write(() => factory(tenantId))).tenantId).toBe(tenantId);
});

it.each(["only-coding", "other-tenant", "multiple-tenants", "alias"])("requires isolated separate grant: %s", async variant => {
  const readPath = join(directory, "read.json"), writePath = join(directory, "write.json");
  await writeFile(readPath, "synthetic", { mode: 0o600 });
  if (variant === "alias") await link(readPath, writePath); else await writeFile(writePath, "synthetic", { mode: 0o600 });
  vi.stubEnv("XERO_TOKEN_FILE", readPath); vi.stubEnv("XERO_CLIENT_ID", "read-app");
  vi.stubEnv("XERO_RECODING_TOKEN_FILE", writePath); vi.stubEnv("XERO_RECODING_TOKEN_KEY_FILE", join(directory, "write.key")); vi.stubEnv("XERO_RECODING_CLIENT_ID", "separate-app");
  const tokens = vi.spyOn(DurableOAuthProvider.prototype, "getTokenSet").mockResolvedValue({ scope: "accounting.banktransactions", access_token: "synthetic" });
  vi.spyOn(clients.TenantXeroClient.prototype, "authenticate").mockImplementation(async function (this: clients.TenantXeroClient) {
    Object.defineProperty(this, "tenants", { value: variant === "other-tenant" ? [{ tenantId: others[0] }] : variant === "multiple-tenants" ? [{ tenantId }, { tenantId: others[0] }] : [{ tenantId }] });
  });
  const factory = createBankCodingClientFactory({ ...config, grantMode: "separate" });
  if (variant === "only-coding") expect((await write(() => factory(tenantId))).tenantId).toBe(tenantId);
  else await expect(write(() => factory(tenantId))).rejects.toThrow();
  if (variant === "alias") expect(tokens).not.toHaveBeenCalled();
});
