# Account coding: Demo Company validation gate

Status: **not executed; apply remains disabled by default**. The PR includes a
complete dry-run preview and narrowly authorized apply implementation. Mocked
validation does not establish Xero's preservation behavior or actual statement
linkage. Production activation requires the evidence below and an explicitly
approved OAuth grant choice; neither has occurred.

The permitted edit is an existing line's account assignment (`AccountCode` and
associated GL `AccountID`). Preserve descriptions/references, transaction/line IDs,
all other lines, tracking, explicit tax type/amount, quantity/unit/line amounts,
currency/rate, date, contact, bank account and totals. GST/tax, tracking edits,
line creation/deletion, payments, transfers and lodgements are excluded.

The [Accounting BankTransactions contract](https://developer.xero.com/documentation/api/accounting/banktransactions)
supports existing authorised SPEND/RECEIVE updates before or after reconciliation.
Every original `LineItemID` must be retained: omitted lines are deleted and ID-less
lines recreated. An unreconciled Accounting transaction is an existing ledger
entry; it is not a raw uncoded bank-feed statement line. The public Accounting API
cannot read that raw reconciliation queue or match its lines.

`IsReconciled` can be set without an actual statement match; never set it to fake
proof. The [Accounting statements endpoint](https://developer.xero.com/documentation/api/accounting/bankstatements)
does not provide statement matching. Use Xero's supported UI to witness the
actual imported line's existing link, never undocumented browser endpoints.
Separately entitled [Finance Bank Statements Plus](https://developer.xero.com/documentation/api/finance/bankstatementsplus)
can additionally witness `statementLineId` and its linked bank-transaction ID.
Finance entitlement/access is not assumed or requested here.

## Authorized experiment and evidence

1. Obtain explicit approval for an isolated Demo-only OAuth app/grant and the exact
   account-only changes. Do not expand the production app/grant. Record the Demo
   tenant ID privately and allow only that tenant during the experiment. Grant
   `offline_access`, `accounting.banktransactions`, `accounting.settings.read`
   only under that approval. A separately approved provider may be used for the
   write grant; its connected tenant set must contain only the Demo tenant.
2. Import uniquely identifiable statement lines into a Demo bank account. In Xero,
   reconcile one SPEND and one RECEIVE to existing authorised transactions. Use
   multiple lines and tracking in at least one case. Record the imported statement
   line ID if available; otherwise keep a private screenshot/export with a file
   hash and unambiguous row locator, bank account, date, amount and reference.
   Follow each existing statement link to its exact `BankTransactionID`. A boolean
   reconciliation flag, matching amount or a new match is insufficient evidence.
3. GET full transaction records with `unitdp=4`, GET the chart, and prepare the
   account-only preview for each existing line. Save the complete before/proposed
   records, exact diff and hash privately. Confirm the target GL account ID/code,
   explicit existing tax coding (not target account defaults), all original line
   IDs and selected-line descriptions, and obtain exact test-action approval.
4. To establish the initial external linkage gate while server apply is disabled,
   use supported API Explorer with the isolated Demo grant to POST one approved
   update to `/BankTransactions/{BankTransactionID}`. Supply the Demo tenant header,
   all original line items/IDs, original tax/tracking/amount fields and only the
   approved account assignment changes. Use SDK/API serialization and `unitdp=4`
   with a unique idempotency key. Omit computed totals, currency/rate read fields,
   `UpdatedDateUTC`, read-only response metadata and `IsReconciled` from the body.
   Never PUT/create, delete/recreate, detach a match, force reconciliation or call
   payments/transfers. A validation rejection fails feasibility; do not broaden
   the payload or scope without another reviewed preview/approval.
5. Capture the update response and a fresh GET. Confirm only the approved code and
   associated GL account ID changed; every original transaction/line ID, unrelated
   line, description/reference, tracking, explicit tax, quantity/amount, currency,
   rate and total must match. Xero may omit GL account ID while returning the
   correct code; compare it to the chart when present. Unexpected drift fails.
6. Re-open the *same imported statement line* and follow its existing reconciled
   link. It must still lead to the identical bank transaction ID and bank account;
   no replacement transaction, new unreconciled statement line or recreated match
   is acceptable. Capture before/after linkage evidence with timestamps and row
   identity. If separately entitled, an identical Finance statement-line ID with
   the same linked bank-transaction ID is additional evidence. Ambiguous evidence
   fails the gate. Repeat steps 3–6 for both reconciled SPEND and RECEIVE.
7. After that independent linkage proof, and separate authorization to activate
   only the isolated Demo service, configure the preview/apply policy and a private
   persistent audit directory. Record the approved grant mode and proof reference;
   `XERO_RECODING_LINKAGE_VALIDATED=true` asserts this evidence rather than checking
   it automatically. Use the verified configured owner/client with read and coding
   action scopes. Preview a new exact account change, review it, then call
   `apply-bank-recode` with its tenant, proposal ID, approval hash and
   `confirmed: true`. This validates the actual end-to-end implementation. Capture
   the fsynced intent, receipt/outcome file, GET and the same UI linkage witness.
8. Also run preview/apply on existing *unreconciled* authorised SPEND and RECEIVE
   ledger entries. The flag must stay false; descriptions/references and all other
   invariants must remain unchanged. This does not enable raw bank-feed access.
   Change a record after preview to prove stale rejection; separately prove a
   read-only subject/client, wrong action scope and either other readable tenant
   cannot POST. Do not simulate a live timeout by repeating uncertain writes.

Collect a private evidence bundle with exact tenant/transaction/line/statement
identities, approved diff, before/after records and hashes, timestamps, request
idempotency key, receipts, linkage witnesses and pass/fail results. Any failure
blocks activation; inspect manually rather than retrying, undoing or recreating.
One successful case does not validate every currency variant or excluded change.

## Production gates and limits

- The sole coding organisation must be explicitly configured; every other connected
  organisation remains read-only through this server. Subject/client/action scope
  checks supplement issuer/audience/signature verification and tenant permissions.
- Choose **shared grant with server enforcement** or **separate coding-only grant**
  explicitly. Xero [scopes are additive](https://developer.xero.com/documentation/guides/oauth2/scopes),
  and the [latest token accesses all connected tenants](https://developer.xero.com/documentation/guides/oauth2/auth-flow).
  Adding `accounting.banktransactions` to a shared grant broadens the grant's own
  capability across its connections; server tenant policy does not change that.
  If OAuth-level isolation is required, retain the read grant and approve a separate
  app/grant connected only to the coding organisation. Refresh cannot add scopes.
- The bank transaction scope includes transfers upstream; this workflow still
  rejects transfers, payments and lodgements. No broader legacy write fallback.
- Approval binds the owner, tenant, full snapshot, selected lines and exact diff,
  expires after five minutes and is single-use. Restart discards pending previews.
  Re-fetch both transaction and chart before POST and reject any stale state.
- Xero documents no conditional `If-Match`. Serializing this service's own writes
  does not eliminate outside edits between its GET and POST. Agree and evidence
  an operational editing exclusion procedure before activation; this is not an
  atomic compare-and-swap guarantee.
- Intent is fsynced privately before POST; the separate outcome records applied,
  not-applied, drift or unknown. A mutation timeout, drift or final audit failure
  halts further coding in that process. Inspect actual state and statement linkage
  before recovery/restart; never blindly retry. Set private retention/backup policy.
- Grant approval/consent, production activation, image publication, deployment and
  merge remain separate decisions. This PR does none of those actions.
