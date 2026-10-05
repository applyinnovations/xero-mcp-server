import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountingApi, BankTransaction } from "xero-node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TenantXeroClient } from "../../../clients/xero-client.js";
import { ToolFactory } from "../../tool-factory.js";
import ListBankTransactionsTool from "../list-bank-transactions.tool.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const transaction: BankTransaction = {
  bankTransactionID: "22222222-2222-4222-8222-222222222222",
  type: BankTransaction.TypeEnum.SPEND,
  isReconciled: true, subTotal: 0, totalTax: 0, total: 0,
  bankAccount: { accountID: "33333333-3333-4333-8333-333333333333" },
  lineItems: [{ lineItemID: "44444444-4444-4444-8444-444444444444", unitAmount: 0, quantity: 1,
    taxAmount: 0, tracking: [{ trackingCategoryID: "55555555-5555-4555-8555-555555555555", trackingOptionID: "66666666-6666-4666-8666-666666666666", name: "Region", option: "East" }] }],
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("structured bank reads", () => {
  it("preserves zeros, IDs and tracking and sends reconciled SPEND/RECEIVE filters", async () => {
    vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenantId);
    vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "invalid-fixture-token");
    vi.spyOn(TenantXeroClient.prototype, "authenticate").mockResolvedValue(undefined);
    const get = vi.spyOn(AccountingApi.prototype, "getBankTransactions").mockResolvedValue({
      body: { bankTransactions: [transaction] }, response: {},
    } as Awaited<ReturnType<AccountingApi["getBankTransactions"]>>);
    const tool = ListBankTransactionsTool();
    const args = { tenantId, page: 1, pageSize: 1, reconciledOnly: true };
    const response = await tool.handler(args, {} as Parameters<typeof tool.handler>[1]);
    expect(response.structuredContent).toEqual({ tenantId, pagination: { page: 1, pageSize: 1, mayHaveMore: true }, transactions: [transaction] });
    expect(get.mock.calls[0].slice(0, 7)).toEqual([tenantId, undefined, '(Type=="SPEND" OR Type=="RECEIVE") AND IsReconciled==true', "Date DESC", 1, 4, 1]);
    expect(tool.schema.tenantId.safeParse(undefined).success).toBe(false);
    expect(tool.schema.page.safeParse(0).success).toBe(false);
  });

  it("advertises only read tools while reconciliation proof is pending", () => {
    const server = new McpServer({ name: "test", version: "1" });
    const spy = vi.spyOn(server, "tool");
    ToolFactory(server);
    const names = spy.mock.calls.map((call) => call[0]);
    expect(names).toContain("list-tenants");
    expect(names).toContain("get-bank-transaction");
    expect(names.every((name) => /^(list|get)-/.test(name))).toBe(true);
  });
});
