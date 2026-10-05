import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountingApi, BankTransaction } from "xero-node";
import * as clients from "../../clients/xero-client.js";
import { BankRecodeService } from "../bank-recode-service.js";
import { loadRecodeConfig } from "../config.js";
import { tenantId, others, transaction, accounts, changes } from "./fixtures.js";

let directory: string;
let record: BankTransaction;
let chart = accounts;
let writeScope: string;
const update = () => vi.spyOn(AccountingApi.prototype, "updateBankTransaction");
const setup = (enabled = true) => {
  const service = new BankRecodeService({ tenantId, subjects: ["owner"], clientId: "client", scope: "xero:code", enabled, grantMode: "shared", auditDirectory: directory });
  return { service, authority: { service, subject: "owner", clientId: "client", canApply: true } };
};
const invoke = <T>(callback: () => T): T => clients.runWithXeroClient(new clients.TenantXeroClient(tenantId, { getTokenSet: async () => ({}) }), callback);
const preview = (s: ReturnType<typeof setup>) => invoke(() => s.service.preview(s.authority, tenantId, transaction.bankTransactionID!, changes));
const apply = (s: ReturnType<typeof setup>, p: Awaited<ReturnType<typeof preview>>) => invoke(() => s.service.apply(s.authority, tenantId, p.proposalId, p.approvalHash, true));

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "coding-test-"));
  record = structuredClone(transaction); chart = structuredClone(accounts); writeScope = "accounting.banktransactions";
  vi.spyOn(clients, "configuredTokenProvider").mockImplementation(() => ({ getTokenSet: async () => ({ scope: writeScope, access_token: "synthetic" }) }));
  vi.spyOn(clients.TenantXeroClient.prototype, "authenticate").mockResolvedValue(undefined);
  vi.spyOn(AccountingApi.prototype, "getBankTransaction").mockImplementation(async () => ({ body: { bankTransactions: [structuredClone(record)] }, response: {} }) as Awaited<ReturnType<AccountingApi["getBankTransaction"]>>);
  vi.spyOn(AccountingApi.prototype, "getAccounts").mockImplementation(async () => ({ body: { accounts: structuredClone(chart) }, response: {} }) as Awaited<ReturnType<AccountingApi["getAccounts"]>>);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

it.each([[true, "SPEND"], [false, "SPEND"], [true, "RECEIVE"], [false, "RECEIVE"]] as const)("applies only account assignment and audits %s/%s", async (reconciled, type) => {
  record.isReconciled = reconciled; record.type = type as BankTransaction.TypeEnum;
  const s = setup(), p = await preview(s);
  const post = update().mockImplementation(async (...args) => {
    const intent = JSON.parse(await readFile(join(directory, `${p.proposalId}.intent.json`), "utf8"));
    expect(intent.approvalHash).toBe(p.approvalHash);
    expect(intent.before).toMatchObject({ isReconciled: reconciled, type, reference: record.reference });
    const payload = args[2].bankTransactions![0];
    expect(payload.lineItems).toEqual(p.proposedTransaction.lineItems);
    expect(payload).toMatchObject({ bankTransactionID: record.bankTransactionID, reference: record.reference, contact: record.contact, bankAccount: record.bankAccount });
    for (const key of ["isReconciled", "total", "totalTax", "subTotal", "currencyCode", "currencyRate", "updatedDateUTC"]) expect(payload).not.toHaveProperty(key);
    record = structuredClone(p.proposedTransaction); record.updatedDateUTC = new Date("2026-01-03");
    return { body: { bankTransactions: [record] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>;
  });
  const result = await apply(s, p);
  expect(result).toMatchObject({ outcome: "applied", auditSaved: true, statementLinkageVerified: false });
  expect(post.mock.calls[0].slice(0, 2)).toEqual([tenantId, transaction.bankTransactionID]);
  expect(post.mock.calls[0].slice(3, 5)).toEqual([4, p.proposalId]);
  for (const phase of ["intent", "result"]) expect((await stat(join(directory, `${p.proposalId}.${phase}.json`))).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(join(directory, `${p.proposalId}.result.json`), "utf8"))).toMatchObject({ outcome: "applied" });
  await expect(apply(s, p)).rejects.toThrow("Exact unexpired");
  expect(post).toHaveBeenCalledTimes(1);
});

it("keeps approval immutable when the caller mutates returned preview fields", async () => {
  const s = setup(), p = await preview(s), approved = structuredClone(p.proposedTransaction);
  p.proposedTransaction.reference = "tampered"; p.before.reference = "tampered";
  update().mockImplementation(async (...args) => {
    expect(args[2].bankTransactions![0].reference).toBe(transaction.reference);
    record = approved;
    return { body: { bankTransactions: [record] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>;
  });
  expect(await apply(s, p)).toMatchObject({ outcome: "applied" });
});

it("blocks missing write scope before POST without exposing tokens or provider errors", async () => {
  const s = setup(), p = await preview(s), post = update(); writeScope = "accounting.banktransactions.read";
  expect(await apply(s, p)).toMatchObject({ outcome: "not-applied", reason: "grant" });
  expect(post).not.toHaveBeenCalled();
});

it.each(["transaction", "target-account"])("rejects stale %s state", async change => {
  const s = setup(), p = await preview(s), post = update();
  if (change === "transaction") record.reference = "external edit";
  else chart[0].accountID = others[0];
  expect(await apply(s, p)).toMatchObject({ outcome: "not-applied", reason: "stale-state" });
  expect(post).not.toHaveBeenCalled();
});

it("requires the exact tenant, subject, client, action scope, enabled flag and explicit approval", async () => {
  const s = setup(), p = await preview(s), post = update();
  for (const authority of [{ ...s.authority, subject: "other" }, { ...s.authority, clientId: "other" }, { ...s.authority, canApply: false }]) {
    await expect(invoke(() => s.service.apply(authority, tenantId, p.proposalId, p.approvalHash, true))).rejects.toThrow("not authorized");
  }
  for (const id of others) await expect(invoke(() => s.service.apply(s.authority, id, p.proposalId, p.approvalHash, true))).rejects.toThrow("not authorized");
  await expect(invoke(() => s.service.apply(s.authority, tenantId, p.proposalId, "wrong", true))).rejects.toThrow("Exact unexpired");
  await expect(invoke(() => s.service.apply(s.authority, tenantId, p.proposalId, p.approvalHash, false))).rejects.toThrow("Exact unexpired");
  const disabled = setup(false), d = await preview(disabled);
  await expect(apply(disabled, d)).rejects.toThrow("not authorized");
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300001);
  await expect(apply(s, p)).rejects.toThrow("Exact unexpired");
  expect(post).not.toHaveBeenCalled();
});

it("fails before POST when durable private intent cannot be written", async () => {
  const s = setup(), p = await preview(s), post = update(); await chmod(directory, 0o755);
  expect(await apply(s, p)).toMatchObject({ outcome: "not-applied", reason: "audit-intent" });
  expect(post).not.toHaveBeenCalled();
});

it.each(["timeout", "drift"])("records %s and halts subsequent coding without retry or rollback", async failure => {
  const s = setup(), p = await preview(s), second = await preview(s);
  const post = update().mockImplementation(async () => {
    if (failure === "timeout") throw new Error("sensitive upstream failure");
    record = structuredClone(p.proposedTransaction); record.total = 123;
    return { body: { bankTransactions: [record] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>;
  });
  const result = await apply(s, p);
  expect(result).toMatchObject({ outcome: failure === "timeout" ? "unknown" : "drift", auditSaved: true });
  expect(JSON.stringify(result)).not.toContain("sensitive");
  await expect(apply(s, p)).rejects.toThrow("Exact unexpired");
  await expect(apply(s, second)).rejects.toThrow("halted");
  expect(post).toHaveBeenCalledTimes(1);
});

it("keeps activation disabled by default and requires explicit Demo, grant and action policy", () => {
  vi.stubEnv("XERO_RECODING_TENANT_IDS", ""); vi.stubEnv("XERO_RECODING_ENABLED", "false");
  expect(loadRecodeConfig({}, "xero:read")).toBeUndefined();
  vi.stubEnv("XERO_RECODING_TENANT_IDS", tenantId); vi.stubEnv("MCP_RECODE_SUBJECTS_JSON", '["owner"]'); vi.stubEnv("MCP_RECODE_CLIENT_ID", "client");
  expect(loadRecodeConfig({ owner: [tenantId] }, "xero:read")).toMatchObject({ enabled: false });
  vi.stubEnv("XERO_RECODING_ENABLED", "true");
  expect(() => loadRecodeConfig({ owner: [tenantId] }, "xero:read")).toThrow("activation");
  vi.stubEnv("XERO_RECODING_LINKAGE_VALIDATED", "true"); vi.stubEnv("XERO_RECODING_GRANT_MODE", "shared"); vi.stubEnv("XERO_RECODING_AUDIT_DIR", directory);
  expect(loadRecodeConfig({ owner: [tenantId] }, "xero:read")).toMatchObject({ enabled: true });
  vi.stubEnv("XERO_RECODING_TENANT_IDS", `${tenantId},${others[0]}`);
  expect(() => loadRecodeConfig({ owner: [tenantId, others[0]] }, "xero:read")).toThrow();
});

it("halts after successful mutation if final audit persistence fails", async () => {
  const s = setup(), p = await preview(s), second = await preview(s);
  update().mockImplementation(async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(directory, `${p.proposalId}.result.json`), "occupied", { mode: 0o600 });
    record = structuredClone(p.proposedTransaction);
    return { body: { bankTransactions: [record] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>;
  });
  expect(await apply(s, p)).toMatchObject({ outcome: "applied", auditSaved: false, followUp: expect.stringContaining("do not retry") });
  await expect(apply(s, second)).rejects.toThrow("halted");
  expect(await readFile(join(directory, `${p.proposalId}.result.json`), "utf8")).toBe("occupied");
});

it("serializes its own approved operations before any POST", async () => {
  const s = setup(), first = await preview(s), second = await preview(s);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(clients.configuredTokenProvider).mockImplementation(() => ({ getTokenSet: async () => { await blocked; return { scope: writeScope }; } }));
  const running = apply(s, first), post = update().mockRejectedValue(new Error("fixture timeout"));
  await expect(apply(s, second)).rejects.toThrow("Another bank coding");
  expect(post).not.toHaveBeenCalled();
  release(); await running;
  expect(post).toHaveBeenCalledTimes(1);
});

it.each(["only-coding", "other-tenant", "multiple-tenants", "alias"])("requires isolated separate grant: %s", async variant => {
  const { writeFile, link } = await import("node:fs/promises");
  const { DurableOAuthProvider } = await import("../../auth/oauth-provider.js");
  const readPath = join(directory, "read.json"), writePath = join(directory, "write.json");
  await writeFile(readPath, "synthetic", { mode: 0o600 });
  if (variant === "alias") await link(readPath, writePath);
  else await writeFile(writePath, "synthetic", { mode: 0o600 });
  vi.stubEnv("XERO_TOKEN_FILE", readPath); vi.stubEnv("XERO_CLIENT_ID", "read-app");
  vi.stubEnv("XERO_RECODING_TOKEN_FILE", writePath); vi.stubEnv("XERO_RECODING_TOKEN_KEY_FILE", join(directory, "write.key")); vi.stubEnv("XERO_RECODING_CLIENT_ID", "separate-app");
  const tokens = vi.spyOn(DurableOAuthProvider.prototype, "getTokenSet").mockResolvedValue({ scope: writeScope, access_token: "synthetic" });
  vi.mocked(clients.TenantXeroClient.prototype.authenticate).mockImplementation(async function (this: clients.TenantXeroClient) {
    Object.defineProperty(this, "tenants", { value: variant === "other-tenant" ? [{ tenantId: others[0] }] : variant === "multiple-tenants" ? [{ tenantId }, { tenantId: others[0] }] : [{ tenantId }] });
  });
  const s = setup(); s.service.config.grantMode = "separate";
  const p = await preview(s), post = update().mockImplementation(async () => {
    record = structuredClone(p.proposedTransaction);
    return { body: { bankTransactions: [record] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>;
  });
  expect(await apply(s, p)).toMatchObject({ outcome: variant === "only-coding" ? "applied" : "not-applied" });
  expect(post).toHaveBeenCalledTimes(variant === "only-coding" ? 1 : 0);
  if (variant === "alias") expect(tokens).not.toHaveBeenCalled();
});


it("rejects an approval that expires during the final read before POST", async () => {
  const s = setup(), p = await preview(s), post = update(), now = Date.now();
  vi.mocked(AccountingApi.prototype.getBankTransaction).mockImplementation(async () => {
    vi.spyOn(Date, "now").mockReturnValue(now + 300001);
    return { body: { bankTransactions: [record] }, response: {} } as Awaited<ReturnType<AccountingApi["getBankTransaction"]>>;
  });
  expect(await apply(s, p)).toMatchObject({ outcome: "not-applied", reason: "approval-expired" });
  expect(post).not.toHaveBeenCalled();
});
