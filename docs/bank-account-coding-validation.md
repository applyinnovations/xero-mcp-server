# First account-coding validation

Status: **not executed; mutation remains disabled by default**. The first test may
be one explicitly approved existing transaction in the intended live coding
organisation. A Demo Company is optional. There is no mandatory prior Demo test,
proof assertion at startup, separate API Explorer experiment or server approval
workflow. The agent uses existing reads, collaborates with the human independently,
then calls `code-bank-transaction` on the user's behalf.

Only selected-line account assignment (`AccountCode` and associated GL `AccountID`)
may change. Preserve descriptions/references, transaction/line IDs, untouched lines,
tracking, explicit tax coding/amounts, quantities/amounts, currency/rate, date,
contact, bank account and totals. GST/tax changes, tracking edits, line creation or
deletion, payments, transfers and lodgements remain outside this tool.

The [Accounting BankTransactions contract](https://developer.xero.com/documentation/api/accounting/banktransactions)
supports existing authorised SPEND/RECEIVE updates before or after reconciliation.
All original `LineItemID`s must remain: omitted lines are deleted and ID-less lines
recreated. Existing unreconciled Accounting entries are ledger transactions; the
public Accounting API cannot inspect or match the raw bank-feed statement queue.
`IsReconciled` can be set without an actual statement match and must never be forced
to fake proof. Use Xero's supported UI to witness the existing statement link.

## One approved live transaction

1. Once the separately approved image/deployment and grant/action permissions below
   are ready, use ordinary transaction/chart reads to identify one straightforward
   existing reconciled SPEND or RECEIVE. The human selects the transaction, existing
   line ID and target account code and approves that exact change outside MCP.
   Save the original account coding and full read record in the agent/operator's
   normal records. Check the target is active and non-bank and preserve the existing
   tax coding. Coordinate any other editing of this transaction during the test.
2. In Xero, record the exact existing imported statement line and follow its link to
   the selected `BankTransactionID`. Use a statement-line ID if shown, or an
   unambiguous row identity with bank account, date, amount and reference. Capture
   the before witness. Do not import new statements, create test transactions,
   unreconcile or recreate matches for this test.
3. Call `code-bank-transaction` once with only tenant, transaction ID, selected line
   IDs/target account codes and a caller-generated idempotency UUID. Use the observed
   `expectedUpdatedDateUTC` and source `expectedAccountCode` when available. No full
   transaction input, proposal ID, approval hash, expiry or confirmed flag is used.
4. Read the compact result and fetch the full record again using the existing read
   tool. Verify only the approved account code and associated GL account ID changed;
   all original IDs, descriptions/references, untouched lines, tracking, tax,
   quantities/amounts, currency/rate and totals must match. Xero may omit selected
   GL account ID while returning its correct code; when present it must match the
   chart. A rejected, unknown or drift result needs inspection before another call.
   Do not blindly retry, undo, delete/recreate or change the reconciliation flag.
5. Re-open the *same existing statement line* and follow its link. It must still
   lead to the identical bank transaction ID and bank account, without a replacement
   transaction, newly unreconciled line or recreated match. Retain that witness and
   the before/after reads with the selected coding and result in normal records.
   Ambiguous evidence or unexpected differences mean no wider use until reviewed.
   Restoring original coding, if wanted, is another independently approved action.

Every API result still reports `statementLinkageVerified: false`: the API itself
cannot witness this UI link. The human/agent records the actual external witness
separately. One successful selected transaction supports that first test only;
it does not establish every currency/transaction variant or excluded change.

## Permissions and deployment needed for the first test

- The current minimal read grant is `offline_access accounting.banktransactions.read
  accounting.settings.read`. Actual consent for `accounting.banktransactions` is
  required for coding; refresh or an MCP action scope cannot add it. Existing
  read-only onboarding does not request that write scope or replace healthy state.
  An approved consent/renewal and encrypted token import must be handled separately
  using supported OAuth and the existing operator import utility.
- Choose the grant boundary explicitly. **Shared** uses the existing app/grant and
  adds bank-transaction write consent. Xero [scopes are additive](https://developer.xero.com/documentation/guides/oauth2/scopes),
  and the [latest token accesses all connected tenants](https://developer.xero.com/documentation/guides/oauth2/auth-flow):
  this broadens the grant's capability across its connections, while the shared
  company policy denies every MCP mutation for read-only companies. **Separate** retains the read
  grant and uses a distinct approved PKCE app/grant connected only to the coding
  organisation; this keeps other organisations read-only at the OAuth boundary as
  well. It needs separate encrypted state, not a new runtime approval workflow.
- After separately authorized merge/image publication, pin the successful image
  digest in the existing GitOps deployment. Enable `XERO_RECODING_ENABLED=true`,
  set `XERO_TENANT_ACCESS_JSON` with only the approved company as `read-write`
  and every other readable company as `read-only`, set
  `MCP_RECODE_SUBJECTS_JSON` / `MCP_RECODE_CLIENT_ID` to the approved existing user
  and client, and set `MCP_RECODE_SCOPE=xero:code` plus the chosen
  `XERO_RECODING_GRANT_MODE`. Retain all existing read tenant mappings. Separate
  mode additionally needs `XERO_RECODING_CLIENT_ID`, `XERO_RECODING_TOKEN_FILE` and
  `XERO_RECODING_TOKEN_KEY_FILE`; state must not alias the read file and the grant
  must connect exactly the coding tenant. Reuse existing encrypted-state/key
  machinery; do not regenerate a healthy key or embed plaintext credentials.
- Grant the existing identity-provider client the optional coding scope only for
  the approved user, with the existing MCP audience/access-token claims. Request a
  fresh client token with read and coding scopes. No new ChatGPT client or client
  secret is required. Verify allowed tool visibility and denial for other users,
  clients or readable tenants before the approved transaction call.

## Technical limits

Xero documents no conditional `If-Match`. Optional timestamp/source-account checks
reject already stale reads and a small in-flight set rejects overlapping calls
for the same transaction in one process. Outside edits or another replica can
still race GET/POST; coordinate editing of the selected transaction during the test.

The idempotency key belongs only to the identical upstream request.
[Xero caches keys for six minutes from the first call and matches URL, body and HTTP method](https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/).
Reuse after expiry is processed anew. Fresh reads can change the rebuilt POST body
even for identical MCP arguments, so the key is not an unlimited replay guarantee.
The server performs one POST and never retries. Known HTTP/validation rejection
is reported as rejection; timeouts/server errors or unverifiable post-state are
unknown, and post-write drift is an error. Inspect actual transaction and statement
linkage before another action. No persistent approval/outcome state is retained.

Bank transaction consent includes transfers upstream; this tool still excludes
transfers, payments and lodgements. Grant choice/consent, exact first transaction
and account selection, merge, image publication and deployment remain outstanding
until individually authorized. This PR performs none of those actions.
