# Xero OAuth scope coverage

The catalog contains 58 tools: 28 company reads, 26 company mutations and four
connection tools. MCP resource access, company permissions, Xero consent and
Xero's own transaction/user restrictions all apply independently. Advertising a
tool does not establish that the current Xero grant permits its endpoint.

The scope names below follow the current [Xero scope catalogue](https://developer.xero.com/documentation/guides/oauth2/scopes/).
Each read accepts its `.read` scope or the corresponding manage scope. The four
transaction families also accept the deprecated `accounting.transactions.read`
for reads or `accounting.transactions` for reads/writes. Reports accept the
deprecated `accounting.reports.read`. These are compatibility alternatives;
new consent should use the granular scopes.

| Tools | Xero endpoints | Least sufficient consent |
| --- | --- | --- |
| `list-tenants` | GET `/connections` | Valid existing connected grant; no additional accounting scope |
| `list-invoices`, `list-credit-notes`, `list-quotes` | GET `/Invoices`, `/CreditNotes`, `/Quotes` | `accounting.invoices.read` |
| `create-invoice`, `update-invoice`, `create-credit-note`, `update-credit-note`, `create-quote`, `update-quote` | PUT/POST `/Invoices`, `/CreditNotes`, `/Quotes` | `accounting.invoices` |
| `list-items` | GET `/Items` | `accounting.invoices.read` **or** `accounting.settings.read` (or their manage scopes) |
| `create-item`, `update-item` | PUT/POST `/Items` | `accounting.invoices` **or** `accounting.settings` |
| `list-payments` | GET `/Payments` | `accounting.payments.read` |
| `create-payment` | PUT `/Payments` | `accounting.payments` |
| `get-bank-transaction`, `list-bank-transactions` | GET `/BankTransactions` and selected IDs | `accounting.banktransactions.read` |
| `create-bank-transaction`, `update-bank-transaction` | PUT/POST `/BankTransactions` | `accounting.banktransactions` |
| `code-bank-transaction` | GET `/BankTransactions/{id}`, GET `/Accounts`, POST `/BankTransactions/{id}`, verification GET | `accounting.banktransactions` **and** `accounting.settings.read` (or `accounting.settings`) |
| `list-manual-journals` | GET `/ManualJournals` and selected IDs | `accounting.manualjournals.read` |
| `create-manual-journal`, `update-manual-journal` | PUT/POST `/ManualJournals` | `accounting.manualjournals` |
| `list-contacts`, `list-contact-groups` | GET `/Contacts`, `/ContactGroups` and selected IDs | `accounting.contacts.read` |
| `create-contact`, `update-contact` | PUT/POST `/Contacts` | `accounting.contacts` |
| `list-accounts`, `list-organisation-details`, `list-tax-rates`, `list-tracking-categories` | GET `/Accounts`, `/Organisation`, `/TaxRates`, `/TrackingCategories` | `accounting.settings.read` |
| `create-tracking-category`, `update-tracking-category`, `create-tracking-options`, `update-tracking-options` | PUT/POST `/TrackingCategories` and `/Options` | `accounting.settings` |
| `list-aged-payables-by-contact`, `list-aged-receivables-by-contact` | GET `/Reports/AgedPayablesByContact`, `/Reports/AgedReceivablesByContact` | `accounting.reports.aged.read` |
| `list-report-balance-sheet` | GET `/Reports/BalanceSheet` | `accounting.reports.balancesheet.read` |
| `list-profit-and-loss` | GET `/Reports/ProfitAndLoss` | `accounting.reports.profitandloss.read` |
| `list-trial-balance` | GET `/Reports/TrialBalance` | `accounting.reports.trialbalance.read` |
| `list-payroll-employees`, `list-payroll-employee-leave`, `list-payroll-leave-periods`, `list-payroll-employee-leave-types`, `list-payroll-employee-leave-balances` | NZ payroll GET `/Employees` and employee leave subresources | `payroll.employees.read` |
| `list-payroll-leave-types` | NZ payroll GET `/LeaveTypes` | `payroll.settings.read` |
| `get-timesheet`, `list-timesheets` | NZ payroll GET `/Timesheets` and selected IDs | `payroll.timesheets.read` |
| `create-timesheet`, `add-timesheet-line`, `update-timesheet-line`, `approve-timesheet`, `revert-timesheet`, `delete-timesheet` | NZ payroll POST/PUT/DELETE `/Timesheets`, `/Lines`, `/Approve`, `/RevertToDraft` | `payroll.timesheets` |
| `begin-xero-connection`, `continue-xero-connection`, `get-xero-connection-status`, `confirm-xero-connection` | Existing owner-only PKCE flow and encrypted local state | Configured operator-approved scopes; `offline_access` is needed for durable refresh |

Some mutation receipts optionally read `/Organisation` for a view link. That read
uses settings consent; a missing optional link does not invalidate a confirmed
mutation. Mandatory indirect reads, including account coding's chart lookup, are
checked at their actual SDK endpoints.

## Full catalog consent target

`supportedToolConsentScopes` in `src/auth/xero-scopes.ts` describes the 14 scopes
needed to cover the catalog. It does not change the read-only onboarding default,
the configured target or an existing grant:

```text
offline_access
accounting.invoices
accounting.payments
accounting.banktransactions
accounting.manualjournals
accounting.contacts
accounting.settings
accounting.reports.aged.read
accounting.reports.balancesheet.read
accounting.reports.profitandloss.read
accounting.reports.trialbalance.read
payroll.employees.read
payroll.settings.read
payroll.timesheets
```

For an existing grant, retain every previously approved scope in the operator's
`XERO_SCOPES` target as well. Xero consent is additive and the renewal flow checks
the returned scope set exactly. For example, previously granted
`accounting.banktransactions.read` and `accounting.settings.read` remain in the
target even when their manage scopes cover new read requests. Do not revoke a
grant merely to remove this redundancy.

This consent enables access to invoice/bill/credit-note/quote/item data, payments,
bank transactions, journals, contacts, organisation settings and financial
reports. Manage scopes can permit changes throughout their provider-defined
resource families, including endpoints the MCP does not expose. Employee reads
can include sensitive employment, tax and payment data. Payroll timesheet consent
includes approval, reversion and deletion. Company and request write guards still
apply; a scope grant is not approval to perform any accounting or payroll write.

The exposed payroll implementations use **Xero Payroll NZ**. Consent does not
provide a NZ payroll subscription or make NZ endpoints work for an Australian or
UK organisation. AU/UK SDK clients exist, but this catalog has no AU/UK payroll
tools. No employee-write, payrun, payslip, attachment, bank-feed, asset, project,
practice-manager or OpenID scopes are required for the exposed catalog.

Before a regional payroll release, review its supported-operation and scope
matrix against this target. AU routing must check AU endpoint consent and reject
unsupported operations before any NZ or API fallback; identical scope names do
not establish identical regional operations.

## Errors and release sequence

The shared tenant client checks known accounting/NZ-payroll endpoint scope
alternatives before SDK transport. Static bearer setups without scope metadata
remain provider-authoritative. An `insufficient_scope` response gets a fixed
consent error instead of a credential failure; error responses never return
credential-bearing envelopes. Token refresh keeps existing consent and cannot
add scopes. Every company read reports failures with MCP `isError: true`.

To expand access later, review the exact target and its consequences, obtain
action-time approval for the configuration release and supported owner consent
flow, then use `renewGrant: true`. Complete browser consent using the same Xero
account and only the existing approved organisations. Confirm the exact displayed
organisation set before persisting the renewed encrypted grant. Preserve the
existing client/account binding and company policy. Verify scope names and
representative reads after confirmation; writes need their own explicit user
instructions. No source or configuration preparation performs consent, replaces
tokens, adds tenants or changes live access.
