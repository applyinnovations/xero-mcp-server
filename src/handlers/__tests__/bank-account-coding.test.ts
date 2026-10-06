import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountingApi, BankTransaction } from "xero-node";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { runWithTenantPermissions, runWithXeroClient, TenantXeroClient } from "../../clients/xero-client.js";
import { codeXeroBankTransaction } from "../code-xero-bank-transaction.handler.js";
import { codeBankTransaction } from "../../helpers/bank-account-coding.js";
import { tenantId, transaction, accounts, changes, lineItemId } from "./bank-coding-fixtures.js";

const idempotencyKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let record: BankTransaction;
let chart = accounts;
const client = () => new TenantXeroClient(tenantId, { getTokenSet: async () => ({ access_token: "synthetic" }) });
const invoke = (args = changes, expected?: string) => runWithTenantPermissions([tenantId], () => runWithXeroClient(client(), () => codeXeroBankTransaction(transaction.bankTransactionID!, args, idempotencyKey, expected)), [tenantId]);
const post = () => vi.spyOn(AccountingApi.prototype, "updateBankTransaction");
const successfulPost = () => post().mockImplementation(async (...args) => {
  record.lineItems = structuredClone(args[2].bankTransactions![0].lineItems);
  record.updatedDateUTC = new Date("2026-01-03");
  return { body: { bankTransactions: [structuredClone(record)] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>;
});
beforeEach(() => {
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenantId);
  vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenantId]: "read-write" }));
  record = structuredClone(transaction); chart = structuredClone(accounts);
  vi.spyOn(TenantXeroClient.prototype, "authenticate").mockResolvedValue(undefined);
  vi.spyOn(AccountingApi.prototype, "getBankTransaction").mockImplementation(async () => ({ body: { bankTransactions: [structuredClone(record)] }, response: {} }) as Awaited<ReturnType<AccountingApi["getBankTransaction"]>>);
  vi.spyOn(AccountingApi.prototype, "getAccounts").mockImplementation(async () => ({ body: { accounts: structuredClone(chart) }, response: {} }) as Awaited<ReturnType<AccountingApi["getAccounts"]>>);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each([[true, "SPEND"], [false, "SPEND"], [true, "RECEIVE"], [false, "RECEIVE"]] as const)("codes existing %s/%s records preserving every unrelated field", async (reconciled, type) => {
  record.isReconciled = reconciled; record.type = type as BankTransaction.TypeEnum;
  const before = structuredClone(record), update = successfulPost();
  const result = await invoke([{ ...changes[0], expectedAccountCode: "400" }], before.updatedDateUTC!.toISOString());
  expect(result).toMatchObject({ outcome: "updated", preservationVerified: true, statementLinkageVerified: false, idempotencyKey });
  expect(result).not.toHaveProperty("before"); expect(result).not.toHaveProperty("after");
  const expected = structuredClone(before); expected.lineItems![0].accountCode = "500"; expected.lineItems![0].accountID = accounts[0].accountID; expected.updatedDateUTC = record.updatedDateUTC;
  expect(record).toEqual(expected);
  const payload = update.mock.calls[0][2].bankTransactions![0];
  expect(payload.lineItems).toEqual(expected.lineItems);
  expect(payload).toMatchObject({ bankTransactionID: before.bankTransactionID, reference: before.reference, contact: before.contact, bankAccount: before.bankAccount });
  for (const key of ["isReconciled", "total", "totalTax", "subTotal", "currencyCode", "currencyRate", "updatedDateUTC"]) expect(payload).not.toHaveProperty(key);
  expect(update.mock.calls[0].slice(3, 5)).toEqual([4, idempotencyKey]);
  expect(update).toHaveBeenCalledTimes(1);
});

it("keeps nonzero tax/amounts explicit despite different chart defaults", async () => {
  record.lineItems![0].quantity = 3; record.lineItems![0].unitAmount = 35.75;
  record.lineItems![0].lineAmount = 107.25; record.lineItems![0].taxAmount = 9.75; record.lineItems![0].taxType = "INPUT";
  record.total = 107.25; record.totalTax = 9.75; record.subTotal = 97.5; chart[0].taxType = "NONE";
  const before = structuredClone(record); successfulPost();
  expect(await invoke()).toMatchObject({ outcome: "updated" });
  const expected = structuredClone(before.lineItems![0]); expected.accountCode = "500"; expected.accountID = chart[0].accountID;
  expect(record.lineItems![0]).toEqual(expected);
});

it("rejects stale timestamps and selected source accounts before POST", async () => {
  const update = post();
  expect(await invoke(changes, "2026-01-01T00:00:00Z")).toMatchObject({ outcome: "not-applied", code: "stale-state" });
  expect(await invoke([{ ...changes[0], expectedAccountCode: "999" }])).toMatchObject({ outcome: "not-applied", code: "stale-state" });
  expect(update).not.toHaveBeenCalled();
});

it("rejects incomplete records, transfers, unsupported edits and invalid target metadata", async () => {
  const update = post();
  for (const overrides of [{ type: "SPEND-TRANSFER" }, { status: "DELETED" }, { isReconciled: undefined }, { total: undefined }, { lineItems: [{ ...transaction.lineItems![0], lineItemID: undefined }] }]) {
    record = { ...structuredClone(transaction), ...overrides } as BankTransaction;
    expect(await invoke()).toMatchObject({ outcome: "not-applied", code: "validation" });
  }
  record = structuredClone(transaction);
  for (const account of [{ ...accounts[0], status: "ARCHIVED" }, { ...accounts[0], type: "BANK" }, { ...accounts[0], accountID: undefined }]) {
    chart = [account] as typeof accounts;
    expect(await invoke()).toMatchObject({ outcome: "not-applied", code: "validation" });
  }
  chart = [accounts[0], accounts[0]];
  expect(await invoke()).toMatchObject({ outcome: "not-applied", code: "validation" });
  chart = accounts;
  expect(await invoke([...changes, ...changes])).toMatchObject({ outcome: "not-applied", code: "validation" });
  expect(await invoke([{ ...changes[0], taxType: "NONE" } as typeof changes[0]])).toMatchObject({ outcome: "not-applied", code: "validation" });
  expect(update).not.toHaveBeenCalled();
});

it("returns unchanged without a POST when selected codes already match", async () => {
  record.lineItems![0].accountCode = "500"; record.lineItems![0].accountID = accounts[0].accountID;
  const update = post(); expect(await invoke()).toMatchObject({ outcome: "unchanged" }); expect(update).not.toHaveBeenCalled();
});

it.each([400, 401, 403, 404, 405, 409, 413, 415, 422, 429])("reports known Xero rejection %s honestly", async status => {
  const update = post().mockRejectedValue({ response: { statusCode: status }, request: { headers: { authorization: "secret" } } });
  const result = await invoke();
  expect(result).toMatchObject({ outcome: "rejected", httpStatus: status, code: "write" });
  expect(JSON.stringify(result)).not.toContain("secret"); expect(update).toHaveBeenCalledTimes(1);
});

it("reports the real SDK's serialized HTTP validation rejection without retrying or leaking its envelope", async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`/BankTransactions/${transaction.bankTransactionID}?unitdp=4`);
    expect(request.headers['idempotency-key']).toBe(idempotencyKey);
    response.writeHead(400, { "content-type": "application/json", "set-cookie": "SECRET_COOKIE" });
    response.end(JSON.stringify({ ErrorNumber: 10, Type: "ValidationException", Message: "A validation exception occurred", Elements: [
      { Description: "PRIVATE_ECHOED_RECORD", ValidationErrors: [{ Message: "The account code is not valid for this document." }] },
    ] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const sdkClient = client();
    sdkClient.accountingApi.basePath = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    sdkClient.accountingApi.accessToken = "SECRET_BEARER_TOKEN";
    const update = post(); // spy without replacing the installed SDK implementation
    const result = await runWithTenantPermissions([tenantId], () => runWithXeroClient(sdkClient,
      () => codeXeroBankTransaction(transaction.bankTransactionID!, changes, idempotencyKey)), [tenantId]);
    expect(result).toMatchObject({ outcome: "rejected", code: "write", httpStatus: 400,
      validationMessages: ["The account code is not valid for this document."], statementLinkageVerified: false });
    expect(requests).toBe(1); expect(update).toHaveBeenCalledTimes(1);
    expect(record).toEqual(transaction);
    for (const secret of ["SECRET_BEARER_TOKEN", "SECRET_COOKIE", "PRIVATE_ECHOED_RECORD"]) expect(JSON.stringify(result)).not.toContain(secret);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

it.each([408, 500, 503])("keeps serialized timeout/server status %s uncertain without retrying", async status => {
  const update = post().mockRejectedValue(JSON.stringify({ response: { statusCode: status, request: { headers: { authorization: "SECRET" } } } }));
  expect(await invoke()).toMatchObject({ outcome: "unknown", code: "write", httpStatus: status });
  expect(update).toHaveBeenCalledTimes(1);
});

it("reports returned validation messages even when Xero omits the rejected record ID", async () => {
  const update = post().mockResolvedValue({ body: { bankTransactions: [{ validationErrors: [{ message: "Account is not eligible" }] }] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>);
  expect(await invoke()).toMatchObject({ outcome: "rejected", code: "xero-validation", validationMessages: ["Account is not eligible"] });
  expect(update).toHaveBeenCalledTimes(1);
});

it.each(["timeout", "server", "verification", "drift", "validation"])("reports %s without retrying or claiming a successful preservation", async failure => {
  const update = post().mockImplementation(async () => {
    if (failure === "timeout") throw new Error("secret network message");
    if (failure === "server") throw { response: { statusCode: 500 }, request: { headers: { authorization: "secret" } } };
    record = codeBankTransaction(record, changes, chart).transaction;
    if (failure === "verification") vi.mocked(AccountingApi.prototype.getBankTransaction).mockRejectedValue({ response: { statusCode: 403 } });
    if (failure === "drift") record.total = 100;
    if (failure === "validation") return { body: { bankTransactions: [{ ...record, validationErrors: [{ message: "invalid" }] }] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>;
    return { body: { bankTransactions: [record] }, response: {} } as Awaited<ReturnType<AccountingApi["updateBankTransaction"]>>;
  });
  const result = await invoke();
  expect(result.outcome).toBe(failure === "drift" ? "drift" : failure === "validation" ? "rejected" : "unknown");
  expect(JSON.stringify(result)).not.toContain("secret"); expect(update).toHaveBeenCalledTimes(1);
});

it("rejects overlapping local operations and releases only the I/O guard after completion", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(AccountingApi.prototype.getBankTransaction).mockImplementationOnce(async () => {
    await blocked;
    return { body: { bankTransactions: [structuredClone(record)] }, response: {} } as Awaited<ReturnType<AccountingApi["getBankTransaction"]>>;
  });
  const update = successfulPost();
  const running = invoke();
  expect(await invoke()).toMatchObject({ outcome: "not-applied", code: "busy" });
  release(); expect(await running).toMatchObject({ outcome: "updated" });
  expect(await invoke()).toMatchObject({ outcome: "unchanged" }); expect(update).toHaveBeenCalledTimes(1);
});

it("rejects missing lines without mutating source objects", () => {
  const before = structuredClone(transaction);
  expect(() => codeBankTransaction(before, [{ lineItemId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", accountCode: "500" }], accounts)).toThrow();
  expect(before).toEqual(transaction);
  expect(lineItemId).toBe(changes[0].lineItemId);
});
