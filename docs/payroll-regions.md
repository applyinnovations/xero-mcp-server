# Payroll regional configuration

Set `XERO_PAYROLL_REGION=NZ` or `XERO_PAYROLL_REGION=AU`. The value is case
sensitive; unset defaults to NZ for existing deployments. Empty values, UK,
country names and URLs are rejected. Startup and tool construction validate the
configuration. Each tenant client snapshots the selection and rejects calls to
any other payroll SDK API, including UK. There is no automatic regional fallback.
This setting affects payroll only; accounting endpoints are unchanged.

The selection applies to every organisation served by this process. Use separate
server processes for mixed payroll regions. A selected organisation must have the
corresponding Xero payroll subscription and consent. Changing the environment
variable cannot change the organisation's country, subscription or OAuth grant.

## Supported operations and contracts

| Existing MCP tool | NZ | AU |
| --- | --- | --- |
| `list-payroll-employees` | Employees | AU Employees and AU field names |
| `list-timesheets`, `get-timesheet` | NZ Timesheets | AU Timesheets (`hours`, AU daily lines) |
| `create-timesheet` | One NZ timesheet, payroll calendar, dated scalar-unit lines | AU timesheet array request, daily unit arrays; first response timesheet |
| `list-payroll-leave-types` | LeaveTypes | PayItems.LeaveTypes (AU fields, including CurrentRecord) |
| `list-payroll-employee-leave-balances` | EmployeeLeaveBalances | Requested Employee.LeaveBalances; LeaveName and NumberOfUnits displayed as name and balance |
| `list-payroll-employee-leave`, `list-payroll-employee-leave-types`, `list-payroll-leave-periods` | Existing NZ behavior | Unsupported by these tools |
| `add-timesheet-line`, `update-timesheet-line`, `approve-timesheet`, `revert-timesheet`, `delete-timesheet` | Existing NZ behavior | Unsupported by these tools |

Unsupported tools remain discoverable under existing access policy, explicitly
advertise that they are unsupported in AU, and return MCP `isError: true` before
authentication or payroll transport. This describes this server's support, not
an assertion that every related workflow is absent from the AU API. For example,
AU supports whole-timesheet updates; this implementation does not translate NZ
line IDs or approval endpoints into replacements of Australian timesheets.

List tools preserve the existing single-request behavior and may return only the
provider's first page. AU payroll employees display Phone; NZ displays PhoneNumber.
NZ engagement type is not inferred for AU employees. Missing regional fields are
not synthesized from unrelated fields.

AU `create-timesheet` input (in addition to the usual explicit `tenantId`):

```json
{
  "employeeID": "72a0d0c2-0cf8-4f0b-ade1-33231f47b41b",
  "startDate": "2026-10-05",
  "endDate": "2026-10-11",
  "timesheetLines": [{
    "earningsRateID": "966c5c77-2ef0-4320-b6a9-6c27b080ecc5",
    "numberOfUnits": [8, 8, 8, 8, 8, 0, 0]
  }]
}
```

AU omits `payrollCalendarID` and dated `date`/scalar-unit lines. Each daily array
must cover the inclusive date range, including zero-unit days. The handler
validates the regional payload before authentication, and uses the SDK's AU
serializer and response models. NZ retains its payrollCalendarID and dated line
schema. No payload coercion or retry against another region is attempted.

## OAuth requirements

| Operations in either region | Read consent alternatives | Mutation consent |
| --- | --- | --- |
| Employees, employee leave balances; NZ employee leave details/setup/periods | `payroll.employees.read` or `payroll.employees` | No employee mutation tools |
| NZ LeaveTypes / AU PayItems | `payroll.settings.read` or `payroll.settings` | No settings mutation tools |
| Timesheet reads | `payroll.timesheets.read` or `payroll.timesheets` | `payroll.timesheets` for creation and supported NZ mutations |

These are the same payroll scope families in both regions. No payrun, payslip or
employee-write scope is needed for the implemented AU reads. The environment
variable neither requests scopes nor renews consent. Existing shared authentication,
tenant selection, request authorization and company write policy remain in force.
The shared SDK request hook checks AU `Employees`, `PayItems` and `Timesheets`
using the same resolver as NZ and accounting. Read/manage alternatives are
accepted for reads; `payroll.timesheets.read` cannot authorize creation. Static
bearer setups without scope metadata remain provider-authoritative.
Review any scope expansion and owner consent separately; source changes do not
perform OAuth or alter persisted permissions.

## Official contracts

Implementation targets the locked `xero-node` 13.3.0 regional SDKs. AU uses
`https://api.xero.com/payroll.xro/1.0`; NZ uses
`https://api.xero.com/payroll.xro/2.0`. These SDKs have distinct models and method
signatures, not just different URLs.

- [Xero Payroll AU OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-payroll-au.yaml), version 19.1.0, reviewed blob `8d449460c6f972154c7532e0c618df6e249f894c`: Employees, PayItems and Timesheets contracts.
- [Xero Payroll NZ OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-payroll-nz.yaml).
- [AU timesheets](https://developer.xero.com/documentation/api/payrollau/timesheets), [employees](https://developer.xero.com/documentation/api/payrollau/employees), [pay items](https://developer.xero.com/documentation/api/payrollau/payitems).
- [Official OAuth scope catalogue](https://developer.xero.com/documentation/guides/oauth2/scopes).
