import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { bankCodingChangesSchema } from "../../helpers/bank-account-coding.js";
import { codeXeroBankTransaction } from "../../handlers/code-xero-bank-transaction.handler.js";

export default CreateXeroTool({
    name: "code-bank-transaction",
    description: "Attempt account-code changes on selected existing lines of an authorised SPEND/RECEIVE transaction, subject to Xero's edit restrictions. Xero can reject statement-matched transactions; IsReconciled alone proves neither API editability nor statement linkage. Stop on that rejection; use Xero's documented native editing/source-recoding workflow for review, without unreconciling or recreating records. The agent/client owns user approval. After acceptance, checks IDs, tracking, tax, currency and totals; statement linkage still needs external verification. Optional expectedUpdatedDateUTC/expectedAccountCode reject stale state. Use a stable idempotencyKey for the same request; inspect unknown/drift before retrying. Excludes raw statement lines, tax/amount edits and line creation/deletion.",
    access: "write",
    annotations: { destructiveHint: true, idempotentHint: false },
    schema: { bankTransactionId: z.string().uuid(), changes: bankCodingChangesSchema, idempotencyKey: z.string().uuid(), expectedUpdatedDateUTC: z.string().datetime({ offset: true }).optional() },
    handler: async ({ bankTransactionId, changes, idempotencyKey, expectedUpdatedDateUTC }, extra) => {
      const actor = extra.authInfo?.extra?.subject;
      const receipt = { ...await codeXeroBankTransaction(bankTransactionId, changes, idempotencyKey, expectedUpdatedDateUTC), ...(typeof actor === "string" ? { actor } : {}) };
      return { isError: !["updated", "unchanged"].includes(receipt.outcome), structuredContent: receipt, content: [{ type: "text", text: JSON.stringify(receipt) }] };
    },
  });
