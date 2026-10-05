import { isDeepStrictEqual } from "node:util";
import { Account, BankTransaction } from "xero-node";
import { z } from "zod";

export const bankCodingChangesSchema = z.array(z.object({
  lineItemId: z.string().uuid(), accountCode: z.string().trim().min(1).max(50),
  expectedAccountCode: z.string().min(1).max(50).optional(),
}).strict()).min(1).max(50);
export type BankCodingChanges = z.infer<typeof bankCodingChangesSchema>;

export function codeBankTransaction(record: BankTransaction, changes: BankCodingChanges, accounts: Account[]) {
  z.string().uuid().parse(record.bankTransactionID);
  if (!["SPEND", "RECEIVE"].includes(String(record.type)) || String(record.status) !== "AUTHORISED"
      || typeof record.isReconciled !== "boolean" || !record.bankAccount?.accountID || !record.contact?.contactID
      || !record.currencyCode || !record.date || !record.lineAmountTypes
      || ![record.total, record.totalTax, record.subTotal].every(Number.isFinite)) throw new Error("Incomplete authorised SPEND/RECEIVE record");
  const parsed = bankCodingChangesSchema.parse(changes), lines = record.lineItems;
  if (new Set(parsed.map(change => change.lineItemId)).size !== parsed.length) throw new Error("Each line may be selected once");
  if (!lines?.length || new Set(lines.map(line => line.lineItemID)).size !== lines.length) throw new Error("Complete unique line IDs are required");
  for (const line of lines) {
    z.string().uuid().parse(line.lineItemID);
    if (!line.taxType || !line.accountCode || ![line.lineAmount, line.taxAmount, line.quantity, line.unitAmount].every(Number.isFinite)) throw new Error("Complete line amounts and explicit tax coding are required");
  }
  const transaction = structuredClone(record);
  const diff = parsed.map(change => {
    const original = lines.find(line => line.lineItemID === change.lineItemId);
    const targets = accounts.filter(account => account.code === change.accountCode);
    const target = targets.length === 1 ? targets[0] : undefined;
    if (!original || !target || String(target.status) !== "ACTIVE" || target.type === undefined || String(target.type) === "BANK") throw new Error("Select an existing line and a unique active non-bank account");
    z.string().uuid().parse(target.accountID);
    if (change.expectedAccountCode !== undefined && original.accountCode !== change.expectedAccountCode) throw new Error("Selected line account changed");
    const selected = transaction.lineItems!.find(line => line.lineItemID === change.lineItemId)!;
    selected.accountCode = target.code; selected.accountID = target.accountID;
    return { lineItemId: change.lineItemId, before: original.accountCode!, after: target.code! };
  });
  return { transaction, changes: diff, changed: diff.some(change => change.before !== change.after) };
}

export function bankCodingPayload(record: BankTransaction): BankTransaction {
  const payload = structuredClone(record);
  for (const key of ["isReconciled", "updatedDateUTC", "hasAttachments", "validationErrors", "statusAttributeString", "subTotal", "totalTax", "total", "currencyCode", "currencyRate"]) Reflect.deleteProperty(payload, key);
  return payload;
}

export function bankCodingMatches(expectedRecord: BankTransaction, actualRecord: BankTransaction, changes: BankCodingChanges): boolean {
  const expected: BankTransaction = JSON.parse(JSON.stringify(expectedRecord)), actual: BankTransaction = JSON.parse(JSON.stringify(actualRecord));
  Reflect.deleteProperty(expected, "updatedDateUTC"); Reflect.deleteProperty(actual, "updatedDateUTC");
  for (const change of changes) {
    const left = expected.lineItems?.find(line => line.lineItemID === change.lineItemId);
    const right = actual.lineItems?.find(line => line.lineItemID === change.lineItemId);
    if (!left || !right || (right.accountID !== undefined && right.accountID !== left.accountID)) return false;
    Reflect.deleteProperty(left, "accountID"); Reflect.deleteProperty(right, "accountID");
  }
  return isDeepStrictEqual(expected, actual);
}
