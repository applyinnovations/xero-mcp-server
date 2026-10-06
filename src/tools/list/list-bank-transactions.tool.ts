import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listXeroBankTransactions } from "../../handlers/list-xero-bank-transactions.handler.js";
import { xeroClient } from "../../clients/xero-client.js";

const ListBankTransactionsTool = CreateXeroTool({
  name: "list-bank-transactions",
  description: "Read full structured SPEND/RECEIVE bank transactions. Reconciled only by default. Request successive pages until mayHaveMore is false. Reads are not a point-in-time snapshot.",
  access: "read",
  schema: {
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(100),
    bankAccountId: z.string().uuid().optional(),
    type: z.enum(["SPEND", "RECEIVE"]).optional(),
    reconciledOnly: z.boolean().default(true),
  },
  handler: async ({ page, pageSize, bankAccountId, type, reconciledOnly }) => {
    const response = await listXeroBankTransactions(page, bankAccountId, pageSize, type, reconciledOnly);
    if (response.isError) return { isError: true, content: [{ type: "text", text: response.error }] };
    const result = {
      tenantId: xeroClient.tenantId,
      pagination: { page, pageSize, mayHaveMore: response.result.length === pageSize },
      transactions: response.result,
    };
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  },
});
export default ListBankTransactionsTool;
