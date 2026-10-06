import { BankTransaction } from "xero-node";
import { assertTenantWriteAccess, xeroClient } from "../clients/xero-client.js";
import { bankCodingMatches, bankCodingPayload, BankCodingChanges, codeBankTransaction } from "../helpers/bank-account-coding.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";

// Only overlapping local I/O is retained; no approvals, proposals or receipts.
const inFlight = new Set<string>();
const rejectedStatuses = new Set([400, 401, 403, 404, 409, 422, 429]);
function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const response = Reflect.get(error, "response");
  if (!response || typeof response !== "object") return undefined;
  const status = Reflect.get(response, "statusCode") ?? Reflect.get(response, "status");
  return typeof status === "number" ? status : undefined;
}

export async function codeXeroBankTransaction(bankTransactionId: string, changes: BankCodingChanges,
  idempotencyKey: string, expectedUpdatedDateUTC?: string) {
  const tenantId = xeroClient.tenantId, key = `${tenantId}:${bankTransactionId}`;
  const receipt = { tenantId, bankTransactionId, idempotencyKey, statementLinkageVerified: false };
  const done = (outcome: string, details: Record<string, unknown> = {}) => ({ ...receipt, outcome, completedAt: new Date().toISOString(), ...details });
  if (inFlight.has(key)) return done("not-applied", { code: "busy", message: "Another coding request for this transaction is running" });
  inFlight.add(key);
  let submitted = false, code = "authorization";
  try {
    assertTenantWriteAccess(tenantId);
    code = "scope";
    await xeroClient.authenticate(["accounting.banktransactions"]);
    code = "read";
    const [records, chart] = await Promise.all([
      xeroClient.accountingApi.getBankTransaction(tenantId, bankTransactionId, 4, getClientHeaders()),
      xeroClient.accountingApi.getAccounts(tenantId, undefined, undefined, undefined, getClientHeaders()),
    ]);
    const before: BankTransaction | undefined = records.body.bankTransactions?.[0];
    if (!before || before.bankTransactionID !== bankTransactionId) return done("not-applied", { code: "not-found", message: "Bank transaction not found" });
    code = "stale-state";
    if (expectedUpdatedDateUTC !== undefined && (!before.updatedDateUTC || new Date(before.updatedDateUTC).toISOString() !== new Date(expectedUpdatedDateUTC).toISOString())) return done("not-applied", { code, message: "Transaction version changed; read it again" });
    for (const change of changes) if (change.expectedAccountCode !== undefined && before.lineItems?.find(line => line.lineItemID === change.lineItemId)?.accountCode !== change.expectedAccountCode) return done("not-applied", { code, message: "Selected line account changed; read it again" });
    code = "validation";
    const coded = codeBankTransaction(before, changes, chart.body.accounts ?? []);
    if (!coded.changed) return done("unchanged", { changes: coded.changes, message: "Selected lines already have the requested account codes" });
    code = "write"; submitted = true;
    const response = await xeroClient.accountingApi.updateBankTransaction(tenantId, bankTransactionId, { bankTransactions: [bankCodingPayload(coded.transaction)] }, 4, idempotencyKey, getClientHeaders());
    const returned = response.body.bankTransactions?.[0];
    if (!returned || returned.bankTransactionID !== bankTransactionId) return done("unknown", { code: "update-response", message: "Update outcome is uncertain; inspect the transaction and statement match before retrying" });
    if (returned?.validationErrors?.length) return done("rejected", { code: "xero-validation", message: "Xero rejected the account coding; inspect account eligibility and the transaction" });
    code = "verification";
    const after = (await xeroClient.accountingApi.getBankTransaction(tenantId, bankTransactionId, 4, getClientHeaders())).body.bankTransactions?.[0];
    if (!after) return done("unknown", { code, message: "Xero acknowledged the update but verification returned no record; inspect before retrying" });
    const preserved = bankCodingMatches(coded.transaction, after, changes);
    return done(preserved ? "updated" : "drift", { changes: coded.changes, preservationVerified: preserved, updatedDateUTC: after.updatedDateUTC,
      message: preserved ? "Account coding updated; statement linkage still requires the approved external witness" : "Unexpected post-update differences; inspect the transaction and statement match; do not blindly retry or undo" });
  } catch (error) {
    const status = httpStatus(error);
    const rejected = submitted && code === "write" && status !== undefined && rejectedStatuses.has(status);
    return done(submitted ? rejected ? "rejected" : "unknown" : "not-applied", { code, ...(status !== undefined ? { httpStatus: status } : {}),
      message: submitted ? rejected ? "Xero rejected this request; review the reported HTTP status and current transaction" : "Update outcome or preservation is uncertain; inspect the transaction and statement match before retrying" : `No update submitted: ${code} check failed; review configuration or read current state` });
  } finally { inFlight.delete(key); }
}
