import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { bankCodingChangesSchema } from "../../helpers/bank-account-coding.js";
import { codeXeroBankTransaction } from "../../handlers/code-xero-bank-transaction.handler.js";

export default CreateXeroTool({
    name: "code-bank-transaction",
    description: "Assign account codes to selected existing lines of an authorised SPEND/RECEIVE transaction, reconciled or unreconciled. Read/inspect with existing tools; the agent/client owns user approval. Preserves descriptions, references, IDs, tracking, tax, currency and totals. Use optional expectedUpdatedDateUTC/expectedAccountCode to reject stale state and a stable idempotencyKey for the same request. Unknown/drift outcomes require inspection before retrying. Excludes raw statement lines, tax/amount edits and line creation/deletion.",
    support: "maintained",
    access: "write",
    annotations: { destructiveHint: true, idempotentHint: false },
    schema: { bankTransactionId: z.string().uuid(), changes: bankCodingChangesSchema, idempotencyKey: z.string().uuid(), expectedUpdatedDateUTC: z.string().datetime({ offset: true }).optional() },
    handler: async ({ bankTransactionId, changes, idempotencyKey, expectedUpdatedDateUTC }, extra) => {
      const actor = extra.authInfo?.extra?.subject;
      const receipt = { ...await codeXeroBankTransaction(bankTransactionId, changes, idempotencyKey, expectedUpdatedDateUTC), ...(typeof actor === "string" ? { actor } : {}) };
      return { isError: !["updated", "unchanged"].includes(receipt.outcome), structuredContent: receipt, content: [{ type: "text", text: JSON.stringify(receipt) }] };
    },
  });
