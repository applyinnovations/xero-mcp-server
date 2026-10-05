# Reconciled bank recoding: Demo Company gate

Status: **not executed; mutation support remains disabled**. The read-only
`get-bank-recode-proposal` is the first implementation step. A proposal is not
approval or proof that an API update preserves a bank statement match.

The supported initial field is existing line `AccountCode`. Transaction and line
IDs, all other lines, tracking, tax type/amount, line amounts, currency/rate,
date, contact, bank account and totals remain unchanged. Changing GST treatment
(`TaxType`/`TaxAmount`), tracking, amounts or line structure is outside this phase.

Xero's [BankTransactions contract](https://developer.xero.com/documentation/api/accounting/banktransactions)
supports existing SPEND/RECEIVE updates. Keep every `LineItemID`: missing lines are
deleted and ID-less lines are recreated. `IsReconciled` can be set without a
statement match, so that flag is not proof. The
[Accounting statement API](https://developer.xero.com/documentation/api/accounting/bankstatements)
does not expose a statement reconciliation operation. Use Xero's supported UI
for the witness; never use undocumented browser endpoints. If separately entitled,
[Finance Bank Statements Plus](https://developer.xero.com/documentation/api/finance/bankstatementsplus)
can supply `statementLineId` and linked `bankTransactions[].bankTransactionId`.
No Finance access or additional scopes are assumed by this implementation.

## Authorized Demo Company experiment

1. Obtain explicit permission for a separate Demo Company grant and the exact test
   transactions. Never use production organisations or their existing grant.
2. In Xero, import uniquely identifiable statement lines and reconcile one SPEND
   and one RECEIVE to existing transactions. Include multiple lines/tracking in
   one case. Record the statement line identity, bank account, date, amount and
   reference, plus the linked `BankTransactionID`. Keep private screenshots or
   statement exports with a file hash and unambiguous row locator if the UI does
   not expose a line ID. Ambiguous matching is a failed test.
3. Fetch full before records with four unit decimals and prepare the account-code
   proposal. Save its snapshot hash, complete before/proposed records and the
   owner's exact approved diff. Check target codes are active, non-bank accounts;
   preserve explicit existing tax codes rather than adopting account defaults.
4. Only after separate test-action approval, use the supported API Explorer to
   POST the approved existing transaction fields to `/BankTransactions/{id}` with
   the Demo tenant header, every original line ID and a unique idempotency key.
   Use the supported SDK serializer/API field names; preserve all financial fields
   but omit read-only metadata and the reconciliation flag from the write body.
   Do not PUT/create, delete/recreate, set `IsReconciled`, detach a match or call
   payments/transfers. API validation rejection is a failed feasibility test.
5. Re-read the record. Verify the only financial change is the selected
   `AccountCode`; all IDs, line membership, tracking, tax, currency and totals must
   match. Capture the response, a second GET and timestamp for the private audit.
6. Re-open that same statement line in Xero and follow its existing reconciled
   transaction link. It must still point to the identical `BankTransactionID`
   and bank account, with no new unreconciled line or recreated match. Capture
   before/after linkage evidence. If entitled to Finance, verify the identical
   statement-line ID still lists the same bank-transaction ID as additional proof.
7. Test both SPEND and RECEIVE; validate full multi-line/tracking preservation.
   A single successful case does not validate GST changes, transfers, invoices,
   prepayments/overpayments or every currency/transaction variant.

## Gates for a later execution PR

- Separate explicit tenant policy and issuer/subject/client action permission;
  production coding allowlist contains only the approved organisation. Other
  connected organisations remain read-only, even if the token has broader scopes.
- Fresh GET and exact snapshot comparison after approval; reject changed snapshots
  and do not silently regenerate approval. Bind approval to tenant, transaction,
  selected line IDs and diff, with an expiry and single-use execution receipt.
- Xero's documented update contract has no conditional `If-Match` parameter.
  A compare-then-POST still races external edits. Do not claim atomic stale-write
  protection; agree a supported exclusion/locking procedure before execution.
- Record approval, before/after snapshots, IDs, timing, outcome and statement-link
  evidence privately. A mutation timeout is an ambiguous outcome: read/inspect
  before retrying; idempotency keys do not authorize a different payload.
- Stop on post-write drift or failed linkage evidence; do not automatically undo,
  reconcile, delete or recreate accounting transactions.
- Request `accounting.banktransactions` only after explicit OAuth approval. This
  includes bank transfers at Xero's scope level, so application endpoints must
  still exclude transfers, payments and lodgements. Refresh cannot add scopes.
  Xero [scopes are additive](https://developer.xero.com/documentation/guides/oauth2/scopes)
  and the [latest token accesses all connected tenants](https://developer.xero.com/documentation/guides/oauth2/auth-flow).
  A shared multi-organisation grant must not be broadened silently. If the other
  organisations must remain read-only at the OAuth grant boundary, use a separately
  approved app/grant for the coding organisation and keep the existing read grant.
  No such grant is created here.
