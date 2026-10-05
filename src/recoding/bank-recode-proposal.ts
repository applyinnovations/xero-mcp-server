import { createHash } from "node:crypto";
import { Account, BankTransaction } from "xero-node";
import { z } from "zod";

export const bankRecodeChangeSchema = z.object({
  lineItemId: z.string().uuid(),
  accountCode: z.string().trim().min(1).max(50),
}).strict();
export const bankRecodeChangesSchema = z.array(bankRecodeChangeSchema).min(1).max(50);

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function transactionSnapshotHash(tenantId: string, transaction: BankTransaction): string {
  return createHash("sha256").update(JSON.stringify(canonical({ tenantId, transaction }))).digest("hex");
}

// Preserve the complete SDK record, including descriptions and references.
export function bankRecodeProposal(tenantId: string, transaction: BankTransaction,
  changes: z.infer<typeof bankRecodeChangesSchema>, accounts: Account[]) {
  z.string().uuid().parse(tenantId);
  z.string().uuid().parse(transaction.bankTransactionID);
  if (!["SPEND", "RECEIVE"].includes(String(transaction.type)) ||
      String(transaction.status) !== "AUTHORISED" || typeof transaction.isReconciled !== "boolean" ||
      !transaction.bankAccount?.accountID || !transaction.contact?.contactID ||
      !transaction.currencyCode || !transaction.date || !transaction.lineAmountTypes ||
      ![transaction.total, transaction.totalTax, transaction.subTotal].every(Number.isFinite)) {
    throw new Error("Proposal requires a complete authorised SPEND/RECEIVE record");
  }
  const parsed = bankRecodeChangesSchema.parse(changes);
  if (new Set(parsed.map(change => change.lineItemId)).size !== parsed.length) {
    throw new Error("Each line may be selected once");
  }
  const lines = transaction.lineItems;
  if (!lines?.length || new Set(lines.map(line => line.lineItemID)).size !== lines.length) {
    throw new Error("Proposal requires all existing line items with unique IDs");
  }
  for (const line of lines) {
    z.string().uuid().parse(line.lineItemID);
    if (!line.taxType || !line.accountCode ||
        ![line.lineAmount, line.taxAmount, line.quantity, line.unitAmount].every(Number.isFinite)) {
      throw new Error("Proposal requires complete line amounts and explicit tax coding");
    }
  }
  const proposed = structuredClone(transaction);
  const diff = parsed.map(change => {
    const original = lines.find(line => line.lineItemID === change.lineItemId);
    const target = accounts.find(account => account.code === change.accountCode &&
      String(account.status) === "ACTIVE" && account.type !== undefined && String(account.type) !== "BANK" && !!account.accountID);
    if (!original || !target) throw new Error("Select an existing line and an active non-bank account code");
    if (original.accountCode === change.accountCode) throw new Error("Account code is unchanged");
    const selected = proposed.lineItems!.find(line => line.lineItemID === change.lineItemId)!;
    selected.accountCode = change.accountCode;
    selected.accountID = target.accountID;
    return { lineItemId: change.lineItemId, accountCode: { before: original.accountCode, after: change.accountCode }, accountId: { before: original.accountID, after: target.accountID } };
  });
  const snapshotSha256 = transactionSnapshotHash(tenantId, transaction);
  return { dryRun: true, executionEnabled: false, tenantId, bankTransactionId: transaction.bankTransactionID,
    snapshotSha256, changes: diff, before: structuredClone(transaction), proposedTransaction: proposed,
    gate: "Execution requires configured action permission, approved exact diff, OAuth write scope and validated Demo linkage" };
}
