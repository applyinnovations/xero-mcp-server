# Account coding: Demo Company validation gate

Status: **not executed; mutation remains disabled by default**. The MCP surface is
ordinary read tools plus `code-bank-transaction`. The agent/client independently
collaborates with the human and records approval. There are no server proposal,
approval or apply stages, and no accounting snapshots exchanged as mutation input.
Mocked tests cannot establish Xero's actual statement linkage or field preservation.

Only existing selected-line account assignment (`AccountCode` and associated GL
`AccountID`) may change. Preserve descriptions/references, transaction/line IDs,
untouched lines, tracking, explicit tax coding/amounts, quantity/unit/line amounts,
currency/rate, date, contact, bank account and totals. GST/tax changes, tracking
edits, line creation/deletion, payments, transfers and lodgements are excluded.

The [Accounting BankTransactions contract](https://developer.xero.com/documentation/api/accounting/banktransactions)
supports existing authorised SPEND/RECEIVE updates before or after reconciliation.
All original `LineItemID`s must remain: omitted lines are deleted and ID-less lines
recreated. Existing unreconciled Accounting entries are ledger transactions;
the public Accounting API does not expose the raw bank-feed reconciliation queue
or matching operations. `IsReconciled` can be set without an actual statement match
and must never be set to fake proof. Use Xero's supported UI for the witness, never
undocumented browser endpoints. Separately entitled
[Finance Bank Statements Plus](https://developer.xero.com/documentation/api/finance/bankstatementsplus)
can additionally witness the statement-line ID and linked bank-transaction ID;
Finance entitlement/access is not assumed or requested here.

## Approved isolated experiment

1. Obtain explicit approval for a Demo-only OAuth app/grant and exact account-only
   test edits; approval stays with the operator/agent. Do not broaden the production
   app/grant. Record the Demo tenant privately and permit only that tenant in the
   experiment. Approve `offline_access`, `accounting.banktransactions` and
   `accounting.settings.read` for that isolated experiment only.
2. Import uniquely identifiable statement lines into a Demo bank account and use
   Xero to reconcile one SPEND and one RECEIVE to existing authorised transactions.
   Include multiple lines, tracking and nonzero tax/amounts. Record the imported
   statement-line ID if available; otherwise save a private screenshot/export with
   a file hash and unambiguous row locator, bank account, date, amount and reference.
   Follow the existing link to the exact `BankTransactionID`. A reconciliation flag,
   matching amount or a freshly recreated match is insufficient proof.
3. Read the full records with `unitdp=4` and the chart using existing tools. The
   agent/operator agrees which original line IDs receive which account codes,
   retains the before evidence privately, and obtains approval outside the server.
   Check target account ID/code and explicit current tax coding; target account
   defaults must not change tax.
4. Establish the initial external linkage gate while the MCP mutation stays
   disabled, using supported API Explorer with the isolated Demo grant. POST one
   approved update to `/BankTransactions/{BankTransactionID}` with the Demo tenant
   header, every original line/ID, original tax/tracking/amount fields, only the
   approved account assignment changes, `unitdp=4` and a unique idempotency key.
   Omit computed totals, currency/rate read fields, updated timestamp, other
   read-only response metadata and `IsReconciled`. Never PUT/create, delete/recreate,
   detach a match, force reconciliation or call payments/transfers. Rejection fails
   feasibility; do not silently change scope or permitted fields.
5. Capture the response and a fresh GET. Verify only the approved account code and
   associated GL account ID changed. Original transaction/line IDs, every unrelated
   line, descriptions/references, tracking, explicit tax, quantities/amounts,
   currency/rate and totals must match. Xero may omit selected GL account ID while
   returning its correct code; when present it must match the chart. Drift fails.
6. Re-open the *same imported statement line* and follow its existing reconciled
   link. It must still lead to the identical bank transaction ID and bank account;
   no replacement transaction, newly unreconciled statement line or recreated
   match is acceptable. Capture before/after timestamps and exact row identity.
   If independently entitled, verify the same Finance statement-line ID still
   names the same bank-transaction ID as additional evidence. Ambiguous evidence
   fails. Repeat the entire witness for both reconciled SPEND and RECEIVE.
7. After that proof and separate authorization to enable only the isolated Demo
   service, configure the single-tenant action policy and approved grant mode.
   `XERO_RECODING_LINKAGE_VALIDATED=true` asserts that retained evidence. With the
   configured verified user/client and read/coding scopes, inspect via ordinary
   reads, collaborate/approve outside MCP, then call `code-bank-transaction` with
   only tenant, transaction ID, selected line IDs/account codes and caller's
   idempotency UUID. Optional expected update timestamp/source account codes come
   from those reads. Save the compact result, fetch full after evidence with the
   read tool, and repeat the *same statement-line linkage witness*. No server
   proposal ID, approval hash, expiry, confirmed flag or audit files are involved.
8. Repeat direct coding on existing unreconciled authorised SPEND and RECEIVE
   ledger entries; the reconciliation flag must remain false and every other
   invariant must remain intact. This does not authorize raw feed access. Change
   the update timestamp/source account after a read to demonstrate precondition
   rejection. Prove wrong user/client/action scope and either other readable
   tenant cannot POST. Do not induce live timeouts by repeating uncertain writes.

Keep a private evidence bundle in the agent/operator's normal records: exact
Demo tenant/transaction/line/statement identities, approved account choices,
before/after read records and file hashes, timestamp/idempotency key, compact
result, linkage witness and pass/fail outcome. Any failure blocks activation.
Inspect manually; do not automatically retry, undo, reconcile or recreate.

## Production gates and limits

- Configure only the intended coding organisation and explicitly authorized
  user/client/action scope. All other connected organisations remain read-only
  through this server; issuer/audience/signature verification and read mappings
  continue to apply.
- Explicitly choose shared grant/server enforcement or a separate coding-only
  grant. Xero [scopes are additive](https://developer.xero.com/documentation/guides/oauth2/scopes),
  and the [latest token accesses all connected tenants](https://developer.xero.com/documentation/guides/oauth2/auth-flow).
  Server tenant policy does not remove shared-grant write capability. OAuth-level
  isolation requires a distinct approved PKCE app/grant connected only to the
  coding organisation, retaining the existing read grant. Refresh cannot add scopes.
- Bank transaction consent includes transfers upstream; the tool still excludes
  transfers, payments and lodgements and offers no broader legacy write fallback.
- Optional expected timestamp/source-account checks reject already stale reads.
  Xero documents no conditional `If-Match`. The handler's small local in-flight
  set excludes overlapping calls for the same transaction within one process;
  outside edits or another replica can still race GET/POST. Agree and evidence
  an operational editing exclusion procedure; this is not atomic compare-and-swap.
- A stable caller idempotency key belongs only to the identical request. The server
  performs one POST and never retries. Known HTTP/validation rejection is reported
  as rejection, while timeouts/server errors or unverifiable post-state are unknown.
  Post-write drift is an error. Inspect actual transaction and statement linkage
  before another action; no persistent server approval/outcome state is retained.
- All receipts truthfully report `statementLinkageVerified: false`. Successful
  account coding/field comparison cannot replace the actual imported-line witness.
- Consent, grant choice, production activation, merge, image publication and
  deployment remain separate decisions. This PR performs none of those actions.
