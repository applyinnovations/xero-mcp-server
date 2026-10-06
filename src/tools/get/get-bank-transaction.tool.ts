import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { xeroClient } from "../../clients/xero-client.js";
import { getClientHeaders } from "../../helpers/get-client-headers.js";

export default CreateXeroTool({
  name: "get-bank-transaction",
  description: "Read one full SPEND/RECEIVE bank transaction by its ID, including line IDs, tracking, tax, totals and reconciliation status.",
  support: "maintained",
  access: "read",
  schema: { bankTransactionId: z.string().uuid() },
  handler: async ({ bankTransactionId }) => {
    await xeroClient.authenticate();
    const response = await xeroClient.accountingApi.getBankTransaction(xeroClient.tenantId, bankTransactionId, 4, getClientHeaders());
    const transaction = response.body.bankTransactions?.[0];
    if (!transaction || !["SPEND", "RECEIVE"].includes(String(transaction.type))) {
      return { isError: true, content: [{ type: "text", text: "SPEND/RECEIVE bank transaction not found" }] };
    }
    const result = { tenantId: xeroClient.tenantId, transaction };
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  },
});
