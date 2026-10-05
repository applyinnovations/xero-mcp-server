import { realpath, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { BankTransaction, TokenSetParameters } from "xero-node";
import { TenantXeroClient, configuredTokenProvider, xeroClient } from "../clients/xero-client.js";
import { DurableOAuthProvider } from "../auth/oauth-provider.js";
import { EncryptedTokenStore } from "../auth/token-store.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { bankRecodeChangesSchema, bankRecodeProposal, transactionSnapshotHash } from "./bank-recode-proposal.js";
import { writeRecodeAudit } from "./audit.js";
import type { RecodeConfig } from "./config.js";
import type { RecodeContext } from "./context.js";
import { z } from "zod";

type Plan = ReturnType<typeof bankRecodeProposal>;
type Pending = { plan: Plan; subject: string; changes: z.infer<typeof bankRecodeChangesSchema>; expiresAt: number; approvalHash: string };

function updatePayload(record: BankTransaction): BankTransaction {
  const payload = structuredClone(record);
  for (const key of ["isReconciled", "updatedDateUTC", "hasAttachments", "validationErrors", "statusAttributeString", "subTotal", "totalTax", "total", "currencyCode", "currencyRate"]) Reflect.deleteProperty(payload, key);
  return payload;
}
function sameOutcome(plan: Plan, actual: BankTransaction): boolean {
  const expected = structuredClone(plan.proposedTransaction), observed = structuredClone(actual);
  Reflect.deleteProperty(expected, "updatedDateUTC"); Reflect.deleteProperty(observed, "updatedDateUTC");
  for (const change of plan.changes) {
    const left = expected.lineItems?.find(line => line.lineItemID === change.lineItemId);
    const right = observed.lineItems?.find(line => line.lineItemID === change.lineItemId);
    if (!left || !right || (right.accountID !== undefined && right.accountID !== change.accountId.after)) return false;
    // Xero can omit the associated GL account ID while returning its exact code.
    Reflect.deleteProperty(left, "accountID"); Reflect.deleteProperty(right, "accountID");
  }
  return transactionSnapshotHash(plan.tenantId, expected) === transactionSnapshotHash(plan.tenantId, observed);
}

export class BankRecodeService {
  private readonly pending = new Map<string, Pending>();
  private busy = false;
  private halted = false;
  constructor(readonly config: RecodeConfig) {}
  private authorize(authority: RecodeContext, tenantId: string, apply = false) {
    if (tenantId !== this.config.tenantId || !this.config.subjects.includes(authority.subject) || authority.clientId !== this.config.clientId ||
        (apply && (!this.config.enabled || !authority.canApply))) throw new Error("Bank coding action is not authorized");
  }
  private async read(id: string) {
    const [record, chart] = await Promise.all([
      xeroClient.accountingApi.getBankTransaction(xeroClient.tenantId, id, 4, getClientHeaders()),
      xeroClient.accountingApi.getAccounts(xeroClient.tenantId, undefined, undefined, undefined, getClientHeaders()),
    ]);
    const transaction = record.body.bankTransactions?.[0];
    if (!transaction || transaction.bankTransactionID !== id) throw new Error("Bank transaction not found");
    return { transaction, accounts: chart.body.accounts ?? [] };
  }
  async preview(authority: RecodeContext, tenantId: string, id: string, changes: Pending["changes"]) {
    this.authorize(authority, tenantId);
    for (const [key, value] of this.pending) if (value.expiresAt <= Date.now()) this.pending.delete(key);
    if (this.pending.size >= 20) throw new Error("Too many outstanding coding previews");
    await xeroClient.authenticate();
    const { transaction, accounts } = await this.read(id);
    const plan = bankRecodeProposal(tenantId, transaction, changes, accounts);
    const proposalId = randomUUID(), expiresAt = Date.now() + 300000;
    const approvalHash = createHash("sha256").update(JSON.stringify({ proposalId, subject: authority.subject, expiresAt, plan })).digest("hex");
    this.pending.set(proposalId, { plan: structuredClone(plan), subject: authority.subject, changes: structuredClone(changes), expiresAt, approvalHash });
    return { ...structuredClone(plan), executionEnabled: this.config.enabled && authority.canApply, proposalId, expiresAt: new Date(expiresAt).toISOString(), approvalHash };
  }
  private async writer(): Promise<TenantXeroClient> {
    let provider;
    if (this.config.grantMode === "shared") provider = configuredTokenProvider();
    else if (this.config.grantMode === "separate") {
      const path = process.env.XERO_RECODING_TOKEN_FILE, key = process.env.XERO_RECODING_TOKEN_KEY_FILE, clientId = process.env.XERO_RECODING_CLIENT_ID;
      const readPath = process.env.XERO_TOKEN_FILE;
      if (!path || !key || !clientId || !readPath || clientId === process.env.XERO_CLIENT_ID) throw new Error("Separate coding grant requires a distinct approved OAuth app and complete state paths");
      const [readFile, writeFile] = await Promise.all([realpath(readPath), realpath(path)]);
      const [readStat, writeStat] = await Promise.all([stat(readFile), stat(writeFile)]);
      if (readFile === writeFile || (readStat.dev === writeStat.dev && readStat.ino === writeStat.ino)) throw new Error("Separate coding state must not alias the read grant");
      provider = new DurableOAuthProvider({ store: new EncryptedTokenStore(path, key, clientId), clientId });
    } else throw new Error("Coding grant mode is not approved");
    const tokens: TokenSetParameters = await provider.getTokenSet();
    if (!(tokens.scope ?? "").split(" ").includes("accounting.banktransactions")) throw new Error("Coding grant lacks accounting.banktransactions consent");
    const client = new TenantXeroClient(this.config.tenantId, { getTokenSet: async () => tokens });
    await client.authenticate();
    if (this.config.grantMode === "separate" && (client.tenants.length !== 1 || client.tenants[0].tenantId !== this.config.tenantId)) throw new Error("Separate coding grant must connect only the coding tenant");
    return client;
  }
  async apply(authority: RecodeContext, tenantId: string, proposalId: string, approvalHash: string, confirmed: boolean) {
    this.authorize(authority, tenantId, true);
    const pending = this.pending.get(proposalId);
    if (!confirmed || !pending || pending.subject !== authority.subject || pending.approvalHash !== approvalHash || pending.plan.tenantId !== tenantId || pending.expiresAt <= Date.now()) throw new Error("Exact unexpired preview and explicit confirmation required");
    if (this.halted) throw new Error("Coding is halted after an uncertain outcome; operator inspection required");
    if (this.busy) throw new Error("Another bank coding action is running");
    this.busy = true;
    this.pending.delete(proposalId); // Approval is single-use, including ambiguous outcomes.
    let submitted = false, reason = "grant", result: Record<string, unknown>;
    try {
      const writer = await this.writer();
      reason = "read";
      await xeroClient.authenticate();
      const current = await this.read(pending.plan.bankTransactionId!);
      reason = "stale-state";
      const fresh = bankRecodeProposal(tenantId, current.transaction, pending.changes, current.accounts);
      if (fresh.snapshotSha256 !== pending.plan.snapshotSha256 || transactionSnapshotHash(tenantId, fresh.proposedTransaction) !== transactionSnapshotHash(tenantId, pending.plan.proposedTransaction)) throw new Error("Transaction or selected chart account changed; obtain a new preview");
      reason = "approval-expired";
      if (pending.expiresAt <= Date.now()) throw new Error("Approval expired while reading current state");
      reason = "audit-intent";
      if (!this.config.auditDirectory) throw new Error("Private audit directory is required");
      await writeRecodeAudit(this.config.auditDirectory, proposalId, "intent", { proposalId, subject: authority.subject, clientId: authority.clientId, actionScope: this.config.scope, grantMode: this.config.grantMode, expiresAt: new Date(pending.expiresAt).toISOString(), approvalHash, approvedAt: new Date().toISOString(), ...pending.plan });
      reason = "write-or-verification";
      submitted = true;
      const response = await writer.accountingApi.updateBankTransaction(tenantId, pending.plan.bankTransactionId!, { bankTransactions: [updatePayload(pending.plan.proposedTransaction)] }, 4, proposalId, getClientHeaders());
      const returned = response.body.bankTransactions?.[0];
      if (!returned || returned.validationErrors?.length || returned.bankTransactionID !== pending.plan.bankTransactionId) throw new Error("Update response requires inspection");
      const after = (await xeroClient.accountingApi.getBankTransaction(tenantId, pending.plan.bankTransactionId!, 4, getClientHeaders())).body.bankTransactions?.[0];
      result = { proposalId, tenantId, bankTransactionId: pending.plan.bankTransactionId, outcome: after && sameOutcome(pending.plan, after) ? "applied" : "drift", after,
        statementLinkageVerified: false, followUp: "Statement linkage cannot be witnessed through the Accounting API; retain approved Demo evidence and verify in Xero" };
    } catch {
      result = { proposalId, tenantId, bankTransactionId: pending.plan.bankTransactionId, outcome: submitted ? "unknown" : "not-applied", reason, auditSaved: false, statementLinkageVerified: false,
        followUp: submitted ? "Do not retry; inspect the transaction and statement match before another action" : "No POST submitted; obtain a new preview after checking scope, stale state and audit configuration" };
    }
    if (submitted) {
      try { await writeRecodeAudit(this.config.auditDirectory!, proposalId, "result", { ...result, completedAt: new Date().toISOString() }); result.auditSaved = true; }
      catch { result.auditSaved = false; result.followUp = "Inspect the saved intent and transaction; final audit persistence failed; do not retry"; }
    }
    this.halted = submitted && (result.outcome !== "applied" || result.auditSaved !== true);
    this.busy = false;
    return result;
  }
}
