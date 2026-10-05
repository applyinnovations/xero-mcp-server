import { afterEach, expect, it, vi } from "vitest";
import { Account, AccountingApi, BankTransaction } from "xero-node";
import { TenantXeroClient, runWithTenantPermissions } from "../../clients/xero-client.js";
import { bankRecodeProposal } from "../bank-recode-proposal.js";
import GetBankRecodeProposalTool from "../../tools/get/get-bank-recode-proposal.tool.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const others = ["77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"];
const lineItemId = "44444444-4444-4444-8444-444444444444";
const transaction = {
  bankTransactionID: "22222222-2222-4222-8222-222222222222", type: "SPEND", status: "AUTHORISED",
  isReconciled: true, currencyCode: "AUD", currencyRate: 1, lineAmountTypes: "Inclusive",
  date: "2026-01-01", updatedDateUTC: new Date("2026-01-02T00:00:00Z"), total: 0, totalTax: 0, subTotal: 0,
  contact: { contactID: "33333333-3333-4333-8333-333333333333" }, bankAccount: { accountID: "99999999-9999-4999-8999-999999999999" },
  lineItems: [{ lineItemID: lineItemId, accountCode: "400", taxType: "NONE", lineAmount: 0,
    taxAmount: 0, unitAmount: 0, quantity: 1, description: "fixture",
    tracking: [{ trackingCategoryID: "55555555-5555-4555-8555-555555555555", trackingOptionID: "66666666-6666-4666-8666-666666666666", name: "Region", option: "East" }] },
    { lineItemID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", accountCode: "300", taxType: "NONE", lineAmount: 0,
      taxAmount: 0, unitAmount: 0, quantity: 2, description: "untouched fixture", tracking: [] }],
} as BankTransaction;
const accounts = [{ code: "500", status: "ACTIVE", type: "EXPENSE", taxType: "INPUT" }] as Account[];
const changes = [{ lineItemId, accountCode: "500" }];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("preserves all fields, zeros and IDs while changing only a selected account code", () => {
  const proposal = bankRecodeProposal(tenantId, transaction, changes, accounts);
  expect(proposal).toMatchObject({ dryRun: true, executionEnabled: false, tenantId });
  const expected = structuredClone(transaction); expected.lineItems![0].accountCode = "500";
  expect(proposal.before).toEqual(transaction);
  expect(proposal.proposedTransaction).toEqual(expected);
  expect(transaction.lineItems![0].accountCode).toBe("400");
  expect(bankRecodeProposal(others[0], transaction, changes, accounts).snapshotSha256).not.toBe(proposal.snapshotSha256);
  expect(bankRecodeProposal(tenantId, { ...transaction, updatedDateUTC: new Date("2026-01-03") }, changes, accounts).snapshotSha256).not.toBe(proposal.snapshotSha256);
});

it("rejects unsafe records, missing or duplicate lines, invalid accounts and unsupported edits", () => {
  for (const unsafe of [
    { ...transaction, type: "SPEND-TRANSFER" }, { ...transaction, isReconciled: false },
    { ...transaction, lineItems: [{ ...transaction.lineItems![0], lineItemID: undefined }] },
    { ...transaction, lineItems: [transaction.lineItems![0], transaction.lineItems![0]] },
    { ...transaction, lineItems: [{ ...transaction.lineItems![0], taxType: undefined }] },
  ]) expect(() => bankRecodeProposal(tenantId, unsafe as BankTransaction, changes, accounts)).toThrow();
  expect(() => bankRecodeProposal(tenantId, transaction, [...changes, ...changes], accounts)).toThrow();
  expect(() => bankRecodeProposal(tenantId, transaction, [{ lineItemId: others[0], accountCode: "500" }], accounts)).toThrow();
  for (const account of [{ ...accounts[0], status: "ARCHIVED" }, { ...accounts[0], type: "BANK" }]) {
    expect(() => bankRecodeProposal(tenantId, transaction, changes, [account as Account])).toThrow();
  }
  const unsupported = { ...changes[0], taxType: "INPUT" };
  expect(() => bankRecodeProposal(tenantId, transaction, [unsupported], accounts)).toThrow();
});

it("denies both other tenants, disabled configuration and unauthorized subjects before API reads", async () => {
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", [tenantId, ...others].join(","));
  vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "invalid-fixture");
  vi.stubEnv("XERO_RECODING_TENANT_IDS", tenantId);
  const authenticate = vi.spyOn(TenantXeroClient.prototype, "authenticate").mockResolvedValue(undefined);
  const tool = GetBankRecodeProposalTool();
  const invoke = (id: string) => tool.handler({ tenantId: id, bankTransactionId: transaction.bankTransactionID, changes }, {} as Parameters<typeof tool.handler>[1]);
  for (const id of others) expect((await invoke(id)).isError).toBe(true);
  expect((await runWithTenantPermissions(others, () => invoke(tenantId))).isError).toBe(true);
  vi.stubEnv("XERO_RECODING_TENANT_IDS", "");
  expect((await invoke(tenantId)).isError).toBe(true);
  expect(authenticate).not.toHaveBeenCalled();
});

it("uses only transaction/account GETs for an allowed proposal", async () => {
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenantId);
  vi.stubEnv("XERO_RECODING_TENANT_IDS", tenantId);
  vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "invalid-fixture");
  vi.spyOn(TenantXeroClient.prototype, "authenticate").mockResolvedValue(undefined);
  const get = vi.spyOn(AccountingApi.prototype, "getBankTransaction").mockResolvedValue({ body: { bankTransactions: [transaction] }, response: {} } as Awaited<ReturnType<AccountingApi["getBankTransaction"]>>);
  vi.spyOn(AccountingApi.prototype, "getAccounts").mockResolvedValue({ body: { accounts }, response: {} } as Awaited<ReturnType<AccountingApi["getAccounts"]>>);
  const update = vi.spyOn(AccountingApi.prototype, "updateBankTransaction");
  const tool = GetBankRecodeProposalTool();
  const result = await tool.handler({ tenantId, bankTransactionId: transaction.bankTransactionID, changes }, {} as Parameters<typeof tool.handler>[1]);
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ dryRun: true, executionEnabled: false, tenantId });
  expect(get.mock.calls[0].slice(0, 3)).toEqual([tenantId, transaction.bankTransactionID, 4]);
  expect(update).not.toHaveBeenCalled();
});
