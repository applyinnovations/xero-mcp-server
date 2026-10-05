import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { xeroClient } from "../../clients/xero-client.js";
import { BankCodingClientFactory } from "../../auth/bank-coding.js";
import { bankCodingChangesSchema } from "../../helpers/bank-account-coding.js";
import { codeXeroBankTransaction } from "../../handlers/code-xero-bank-transaction.handler.js";

export function registerBankCodingTool(server: McpServer, codingTenantId: string, createWriter: BankCodingClientFactory, actor: string) {
  const tool = CreateXeroTool(
    "code-bank-transaction",
    "Assign account codes to selected existing lines of an authorised SPEND/RECEIVE transaction, reconciled or unreconciled. Read/inspect with existing tools; the agent/client owns user approval. Preserves descriptions, references, IDs, tracking, tax, currency and totals. Use optional expectedUpdatedDateUTC/expectedAccountCode to reject stale state and a stable idempotencyKey for the same request. Unknown/drift outcomes require inspection before retrying. Excludes raw statement lines, tax/amount edits and line creation/deletion.",
    { bankTransactionId: z.string().uuid(), changes: bankCodingChangesSchema, idempotencyKey: z.string().uuid(), expectedUpdatedDateUTC: z.string().datetime({ offset: true }).optional() },
    async ({ bankTransactionId, changes, idempotencyKey, expectedUpdatedDateUTC }) => {
      if (xeroClient.tenantId !== codingTenantId) return { isError: true, content: [{ type: "text", text: "Selected tenant is not allowed for account coding" }] };
      const receipt = { ...await codeXeroBankTransaction(bankTransactionId, changes, idempotencyKey, createWriter, expectedUpdatedDateUTC), actor };
      return { isError: !["updated", "unchanged"].includes(receipt.outcome), structuredContent: receipt, content: [{ type: "text", text: JSON.stringify(receipt) }] };
    },
  )();
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false } }, tool.handler);
}
