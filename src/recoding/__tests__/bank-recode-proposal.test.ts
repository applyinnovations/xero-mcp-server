import { afterEach, expect, it, vi } from "vitest";
import { Account, AccountingApi, BankTransaction } from "xero-node";
import { TenantXeroClient, runWithTenantPermissions } from "../../clients/xero-client.js";
import { bankRecodeProposal } from "../bank-recode-proposal.js";
import GetBankRecodeProposalTool from "../../tools/get/get-bank-recode-proposal.tool.js";

import { tenantId, others, transaction, accounts, changes } from "./fixtures.js";
import { runWithRecodeContext } from "../context.js";
import { BankRecodeService } from "../bank-recode-service.js";
const service = new BankRecodeService({ tenantId, subjects: ["owner"], clientId: "client", scope: "xero:code", enabled: false });
const authority = { service, subject: "owner", clientId: "client", canApply: false };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("preserves all fields, zeros and IDs while changing only a selected account code", () => {
  const proposal = bankRecodeProposal(tenantId, transaction, changes, accounts);
  expect(proposal).toMatchObject({ dryRun: true, executionEnabled: false, tenantId });
  const expected = structuredClone(transaction); expected.lineItems![0].accountCode = "500"; expected.lineItems![0].accountID = accounts[0].accountID;
  expect(proposal.before).toEqual(transaction);
  expect(proposal.proposedTransaction).toEqual(expected);
  expect(transaction.lineItems![0].accountCode).toBe("400");
  expect(bankRecodeProposal(others[0], transaction, changes, accounts).snapshotSha256).not.toBe(proposal.snapshotSha256);
  expect(bankRecodeProposal(tenantId, { ...transaction, updatedDateUTC: new Date("2026-01-03") }, changes, accounts).snapshotSha256).not.toBe(proposal.snapshotSha256);
});

it("rejects unsafe records, missing or duplicate lines, invalid accounts and unsupported edits", () => {
  for (const unsafe of [
    { ...transaction, type: "SPEND-TRANSFER" }, { ...transaction, isReconciled: undefined },
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

it("denies both other tenants, absent request configuration and unauthorized subjects before API reads", async () => {
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", [tenantId, ...others].join(","));
  vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "invalid-fixture");
  vi.stubEnv("XERO_RECODING_TENANT_IDS", tenantId);
  const authenticate = vi.spyOn(TenantXeroClient.prototype, "authenticate").mockResolvedValue(undefined);
  const tool = GetBankRecodeProposalTool();
  const invoke = (id: string) => runWithRecodeContext(authority, () => tool.handler({ tenantId: id, bankTransactionId: transaction.bankTransactionID, changes }, {} as Parameters<typeof tool.handler>[1]));
  for (const id of others) expect((await invoke(id)).isError).toBe(true);
  expect((await runWithTenantPermissions(others, () => invoke(tenantId))).isError).toBe(true);
  expect((await runWithRecodeContext({ ...authority, subject: "other" }, () => tool.handler({ tenantId, bankTransactionId: transaction.bankTransactionID, changes }, {} as Parameters<typeof tool.handler>[1]))).isError).toBe(true);
  expect((await tool.handler({ tenantId, bankTransactionId: transaction.bankTransactionID, changes }, {} as Parameters<typeof tool.handler>[1])).isError).toBe(true);
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
  const result = await runWithRecodeContext(authority, () => tool.handler({ tenantId, bankTransactionId: transaction.bankTransactionID, changes }, {} as Parameters<typeof tool.handler>[1]));
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ dryRun: true, executionEnabled: false, tenantId });
  expect(get.mock.calls[0].slice(0, 3)).toEqual([tenantId, transaction.bankTransactionID, 4]);
  expect(update).not.toHaveBeenCalled();
});
