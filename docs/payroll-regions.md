# Payroll regional configuration

Set `XERO_PAYROLL_REGION=NZ` or `XERO_PAYROLL_REGION=AU`. The value is case
sensitive; unset defaults to NZ for existing deployments. Empty values, UK,
country names and URLs are rejected. Startup validates the configuration after environment loading. The shared tool
factory injects either the NZ or AU module before registration, and binds
invocation clients to that selection and rejects calls to
any other payroll API, including UK. There is no automatic regional fallback.
This setting affects payroll only; accounting endpoints are unchanged.

The selection applies to every organisation served by this process. Use separate
server processes for mixed payroll regions. A selected organisation must have the
corresponding Xero payroll subscription and consent. Changing the environment
variable cannot change the organisation's country, subscription or OAuth grant.

## Supported operations and contracts

| Existing MCP tool | NZ | AU |
| --- | --- | --- |
| `list-payroll-employees` | Employees | AU Employees and AU field names |
| `list-timesheets`, `get-timesheet` | NZ Timesheets | AU Timesheets 2.0 (`totalHours`, dated scalar-unit lines) |
| `create-timesheet` | One NZ timesheet, payroll calendar, dated scalar-unit lines | One AU 2.0 timesheet, payroll calendar, dated scalar-unit lines, optional tracking item |
| `list-payroll-leave-types` | LeaveTypes | PayItems.LeaveTypes (AU fields, including CurrentRecord) |
| `list-payroll-employee-leave-balances` | EmployeeLeaveBalances | Requested Employee.LeaveBalances; AU leaveName and numberOfUnits retained |
| `list-payroll-employee-leave`, `list-payroll-employee-leave-types`, `list-payroll-leave-periods` | Existing NZ behavior | Not registered |
| `add-timesheet-line`, `update-timesheet-line`, `approve-timesheet`, `revert-timesheet`, `delete-timesheet` | Existing NZ behavior | AU Timesheets 2.0 line and lifecycle endpoints |

The NZ module registers 14 payroll tools (8 reads and 6 mutations); AU registers
11 (5 reads and the same 6 mutations). The three NZ employee-leave detail/setup/period
tools are absent from AU tools/list and cannot be called. Unknown tool calls stop
at MCP registration without authentication or provider requests. This describes
this server's support; it does not claim those workflows are absent from Xero's AU API.

With full resource access the total catalog is NZ 58 / AU 55. Company-only access
exposes NZ 54 / AU 51 (reads 28 / 25, mutations 26 in both); connection access adds
up to four tools independently. Accounting tools and access annotations are preserved.
Restart the server after changing the region; HTTP requests use the module selected
at server construction. Changing the environment in a running process does not
change either its advertised contracts or invocation clients.

List tools preserve the existing single-request behavior and may return only the
provider's first page. AU tools return JSON text using AU SDK field names (phone, leaveName, numberOfUnits);
NZ retains its existing text presentation and NZ fields. AU employee output selects
identity/contact/employment fields and does not dump financial/tax fields.
NZ engagement type is not inferred for AU employees. Missing regional fields are
not synthesized from unrelated fields.

AU `create-timesheet` input (in addition to the usual explicit `tenantId`):

```json
{
  "employeeID": "72a0d0c2-0cf8-4f0b-ade1-33231f47b41b",
  "payrollCalendarID": "1a6cbeab-1946-4c17-8020-1d6b459ad389",
  "startDate": "2026-10-05",
  "endDate": "2026-10-11",
  "timesheetLines": [{
    "earningsRateID": "966c5c77-2ef0-4320-b6a9-6c27b080ecc5",
    "date": "2026-10-05",
    "numberOfUnits": 8
  }]
}
```

AU 2.0 requires `payrollCalendarID` and dated `date`/scalar-unit lines. Optional
`trackingItemID` identifies an AU tracking item. AU 1.0 daily arrays and array
requests are rejected. Dates must be real calendar dates, the end must not precede
the start, and supplied lines must lie within the inclusive period. Xero also
requires a new timesheet's start to follow the employee's existing timesheets;
the server leaves that provider state rule to Xero without extra reads or retries.
AU line add/update use the same dated scalar-line schema, with the timesheet ID
and, for updates, the line ID supplied separately.

AU responses use lowercase `timesheets`, `timesheet` and `timesheetLine` envelopes,
`totalHours` and `problem`. The typed adapter validates receipts and reports
provider problems, malformed responses or mismatched identifiers as errors.
DELETE requires an OK response envelope and has no resource receipt. NZ retains
its existing SDK models and text behavior in its own client, handlers, schemas and tools. No payload coercion or retry against AU 1.0,
NZ or another region is attempted.

## OAuth requirements

| Operations in either region | Read consent alternatives | Mutation consent |
| --- | --- | --- |
| Employees, employee leave balances; NZ employee leave details/setup/periods | `payroll.employees.read` or `payroll.employees` | No employee mutation tools |
| NZ LeaveTypes / AU PayItems | `payroll.settings.read` or `payroll.settings` | No settings mutation tools |
| Timesheet reads | `payroll.timesheets.read` or `payroll.timesheets` | `payroll.timesheets` for creation, line updates and lifecycle mutations in both regions |

These are the same payroll scope families in both regions. No payrun, payslip or
employee-write scope is needed for the implemented AU reads. The environment
variable neither requests scopes nor renews consent. Existing shared authentication,
tenant selection, request authorization and company write policy remain in force.
The shared request gate checks AU `Employees`, `PayItems` and `Timesheets`
using the same resolver as NZ and accounting. Both the SDK and the AU 2.0 adapter
reuse tenant authentication, connected-tenant checks, allowlists, request and
company write policy, and endpoint consent. The adapter fixes the provider origin
and disables redirects so bearer credentials cannot follow a redirect. Read/manage alternatives are
accepted for reads; `payroll.timesheets.read` cannot authorize mutations. Static
bearer setups without scope metadata remain provider-authoritative.
Review any scope expansion and owner consent separately; source changes do not
perform OAuth or alter persisted permissions.

## Official contracts

Implementation retains the locked `xero-node` 13.3.0 dependency. AU Employees and
PayItems use that SDK's `https://api.xero.com/payroll.xro/1.0` contracts. AU
Timesheets use a narrow typed adapter for the official AU 2.0 contract at
`https://api.xero.com/payroll.xro/2.0`. NZ uses its existing SDK at the same 2.0
prefix; matching prefixes do not make its models or API client the AU implementation.
AU SDK Timesheets 1.0 calls are explicitly disabled in the shared request hook.

Xero deprecates AU Timesheets 1.0 and retires it on **1 November 2027**, recommending
2.0 for new integrations. This notice applies to Timesheets; the current AU
Employees and PayItems contracts remain at 1.0. The official published Node SDK
20.0.0 still exposes only AU 1.0, so a broad dependency upgrade does not provide
the AU 2.0 client. The adapter avoids unrelated SDK/accounting changes. Its scope
is the existing MCP timesheet operations; AU 2.0's additional delete-line endpoint
is not exposed as a new MCP tool.

- [Xero Payroll AU OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-payroll-au.yaml), version 19.1.0, reviewed blob `8d449460c6f972154c7532e0c618df6e249f894c`: Employees and PayItems contracts.
- [Xero Payroll AU 2.0 OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-payroll-au-v2.yaml), version 19.1.0, reviewed blob `e3a31a402e0011ba7b0e2482617709d8389df570`: AU Timesheets contracts.
- [Official Node SDK 20.0.0 AU client](https://github.com/XeroAPI/xero-node/blob/20.0.0/src/gen/api/payrollAUApi.ts), [release](https://github.com/XeroAPI/xero-node/releases/tag/20.0.0).
- [Xero Payroll NZ OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-payroll-nz.yaml).
- [AU timesheets](https://developer.xero.com/documentation/api/payrollau/timesheets), [employees](https://developer.xero.com/documentation/api/payrollau/employees), [pay items](https://developer.xero.com/documentation/api/payrollau/payitems).
- [Official OAuth scope catalogue](https://developer.xero.com/documentation/guides/oauth2/scopes).
