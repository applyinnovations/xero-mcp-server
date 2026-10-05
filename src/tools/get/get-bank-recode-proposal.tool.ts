import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { configuredTenantIds, xeroClient } from "../../clients/xero-client.js";
import { getClientHeaders } from "../../helpers/get-client-headers.js";
import { bankRecodeChangesSchema, bankRecodeProposal } from "../../recoding/bank-recode-proposal.js";

export default CreateXeroTool(
  "get-bank-recode-proposal",
  "Read-only account-code proposal for existing reconciled SPEND/RECEIVE lines. Preserves IDs, tracking, tax, currency and totals. Does not execute changes or prove statement linkage.",
  { bankTransactionId: z.string().uuid(), changes: bankRecodeChangesSchema },
  async ({ bankTransactionId, changes }) => {
    const allowed = (process.env.XERO_RECODING_TENANT_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean)
      .map(id => z.string().uuid().parse(id));
    if (!allowed.length || !allowed.every(id => configuredTenantIds().includes(id)) || !allowed.includes(xeroClient.tenantId)) {
      throw new Error("Selected tenant is not enabled for recoding proposals");
    }
    await xeroClient.authenticate();
    const [record, chart] = await Promise.all([
      xeroClient.accountingApi.getBankTransaction(xeroClient.tenantId, bankTransactionId, 4, getClientHeaders()),
      xeroClient.accountingApi.getAccounts(xeroClient.tenantId, undefined, undefined, undefined, getClientHeaders()),
    ]);
    const transaction = record.body.bankTransactions?.[0];
    if (!transaction || transaction.bankTransactionID !== bankTransactionId) throw new Error("Bank transaction not found");
    const proposal = bankRecodeProposal(xeroClient.tenantId, transaction, changes, chart.body.accounts ?? []);
    return { structuredContent: proposal, content: [{ type: "text", text: JSON.stringify(proposal) }] };
  },
);
