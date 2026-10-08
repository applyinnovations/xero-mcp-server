import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountingApi, XeroClient } from "xero-node";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { TenantXeroClient, runWithTenantPermissions, runWithXeroClient } from "../../clients/xero-client.js";
import { listXeroInvoices } from "../list-xero-invoices.handler.js";
import { ToolCatalog } from "../../tools/index.js";
import { supportedToolConsentScopes } from "../../auth/xero-scopes.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenantId);
  vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "synthetic-fixture");
  vi.spyOn(XeroClient.prototype, "updateTenants").mockImplementation(async function () {
    Object.defineProperty(this, "tenants", { value: [{ tenantId }] });
    return this.tenants;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("does not send an invoice request when the valid grant only consents to bank transactions and settings", async () => {
  const selected = new TenantXeroClient(tenantId, { getTokenSet: async () => ({ access_token: "synthetic-fixture",
    scope: "offline_access accounting.banktransactions.read accounting.settings.read accounting.banktransactions" }) });
  // Exercise the installed SDK against a local fixture, never Xero.
  // Its preflight must reject before dispatch, not rely on a provider 401.
  const transport = vi.fn();
  const fixture = createServer((_request, response) => {
    transport(); response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ Invoices: [] }));
  });
  fixture.listen(0, "127.0.0.1"); await once(fixture, "listening");
  selected.accountingApi.basePath = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
  const request = vi.spyOn(AccountingApi.prototype, "getInvoices");
  try {
    const response = await runWithTenantPermissions([tenantId], () => runWithXeroClient(selected,
      () => listXeroInvoices(1, undefined, ["SYNTHETIC-INVOICE"])));
    expect(response).toMatchObject({ isError: true, result: null, error: expect.stringContaining("OAuth consent") });
    expect(response.error).toContain("accounting.invoices.read");
    expect(response.error).toContain("refresh cannot add scopes");
    expect(request).toHaveBeenCalledTimes(1);
    expect(transport).not.toHaveBeenCalled();
  } finally { await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve())); }
});

it("marks every company read's authentication failure as an MCP error without exposing credentials", async () => {
  vi.spyOn(TenantXeroClient.prototype, "authenticate").mockRejectedValue(JSON.stringify({ response: {
    statusCode: 401, body: { Detail: "insufficient_scope" }, request: { headers: { authorization: "Bearer SECRET_TOKEN" } },
  } }));
  let checked = 0;
  for (const create of ToolCatalog()) {
    const tool = create();
    if (tool.resource !== "company" || tool.access !== "read" || tool.name === "list-tenants") continue;
    const response = await runWithTenantPermissions([tenantId], () => tool.handler({ tenantId, page: 1,
      employeeId: tenantId, contactId: tenantId, bankTransactionId: tenantId, timesheetID: tenantId,
      fromDate: "2026-01-01", toDate: "2026-01-31", date: "2026-01-31" }, {} as never));
    expect(response, tool.name).toMatchObject({ isError: true });
    expect(JSON.stringify(response), tool.name).not.toContain("SECRET_TOKEN");
    checked++;
  }
  expect(checked).toBe(27);
});

const endpoints: [string, string, (client: TenantXeroClient) => Promise<unknown>][] = [
  ["invoices", "accounting.invoices.read", client => client.accountingApi.getInvoices(tenantId)],
  ["credit notes", "accounting.invoices.read", client => client.accountingApi.getCreditNotes(tenantId)],
  ["quotes", "accounting.invoices.read", client => client.accountingApi.getQuotes(tenantId)],
  ["items", "accounting.invoices.read", client => client.accountingApi.getItems(tenantId)],
  ["payments", "accounting.payments.read", client => client.accountingApi.getPayments(tenantId)],
  ["bank transactions", "accounting.banktransactions.read", client => client.accountingApi.getBankTransactions(tenantId)],
  ["manual journals", "accounting.manualjournals.read", client => client.accountingApi.getManualJournals(tenantId)],
  ["contacts", "accounting.contacts.read", client => client.accountingApi.getContacts(tenantId)],
  ["contact groups", "accounting.contacts.read", client => client.accountingApi.getContactGroups(tenantId)],
  ["accounts", "accounting.settings.read", client => client.accountingApi.getAccounts(tenantId)],
  ["organisation", "accounting.settings.read", client => client.accountingApi.getOrganisations(tenantId)],
  ["tax rates", "accounting.settings.read", client => client.accountingApi.getTaxRates(tenantId)],
  ["tracking", "accounting.settings.read", client => client.accountingApi.getTrackingCategories(tenantId)],
  ["balance sheet", "accounting.reports.balancesheet.read", client => client.accountingApi.getReportBalanceSheet(tenantId)],
  ["profit and loss", "accounting.reports.profitandloss.read", client => client.accountingApi.getReportProfitAndLoss(tenantId)],
  ["trial balance", "accounting.reports.trialbalance.read", client => client.accountingApi.getReportTrialBalance(tenantId)],
  ["aged payables", "accounting.reports.aged.read", client => client.accountingApi.getReportAgedPayablesByContact(tenantId, tenantId)],
  ["aged receivables", "accounting.reports.aged.read", client => client.accountingApi.getReportAgedReceivablesByContact(tenantId, tenantId)],
  ["NZ employees", "payroll.employees.read", client => client.payrollNZApi.getEmployees(tenantId)],
  ["NZ leave settings", "payroll.settings.read", client => client.payrollNZApi.getLeaveTypes(tenantId)],
  ["NZ timesheets", "payroll.timesheets.read", client => client.payrollNZApi.getTimesheets(tenantId)],
];

it.each(endpoints)("checks %s consent in the installed SDK before transport", async (_name, required, invoke) => {
  const selected = new TenantXeroClient(tenantId, { getTokenSet: async () => ({ access_token: "synthetic-fixture", scope: "offline_access" }) });
  // An invalid local port is unreachable; a missing-scope check must finish first.
  selected.accountingApi.basePath = "http://127.0.0.1:1";
  selected.payrollNZApi.basePath = "http://127.0.0.1:1";
  await selected.authenticate();
  await expect(runWithTenantPermissions([tenantId], () => invoke(selected))).rejects.toThrow(required);
});

it.each(["accounting.invoices.read", "accounting.invoices", "accounting.transactions.read", "accounting.transactions", undefined])(
  "permits invoice reads with documented consent %s or absent legacy scope metadata", async scope => {
    const transport = vi.fn();
    const fixture = createServer((_request, response) => {
      transport(); response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ Invoices: [] }));
    });
    fixture.listen(0, "127.0.0.1"); await once(fixture, "listening");
    const selected = new TenantXeroClient(tenantId, { getTokenSet: async () => ({ access_token: "synthetic-fixture", scope }) });
    selected.accountingApi.basePath = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
    try {
      const response = await runWithTenantPermissions([tenantId], () => runWithXeroClient(selected, () => listXeroInvoices()));
      expect(response).toMatchObject({ isError: false, result: [] }); expect(transport).toHaveBeenCalledTimes(1);
    } finally { await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve())); }
  });

it("does not elevate read-only consent to writes even with company and request write permission", async () => {
  vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenantId]: "read-write" }));
  const selected = new TenantXeroClient(tenantId, { getTokenSet: async () => ({ access_token: "synthetic-fixture",
    scope: "accounting.invoices.read payroll.timesheets.read" }) });
  selected.accountingApi.basePath = "http://127.0.0.1:1"; selected.payrollNZApi.basePath = "http://127.0.0.1:1";
  await selected.authenticate();
  await expect(runWithTenantPermissions([tenantId], () => selected.accountingApi.createInvoices(tenantId, { invoices: [] }), [tenantId]))
    .rejects.toThrow("accounting.invoices");
  await expect(runWithTenantPermissions([tenantId], () => selected.payrollNZApi.approveTimesheet(tenantId, tenantId), [tenantId]))
    .rejects.toThrow("payroll.timesheets");
});

it("the proposed full-tool target satisfies all documented exposed endpoint families", async () => {
  const selected = new TenantXeroClient(tenantId, { getTokenSet: async () => ({ access_token: "synthetic-fixture",
    scope: supportedToolConsentScopes.join(" ") }) });
  await expect(selected.authenticate(["accounting.invoices.read", "accounting.payments.read", "accounting.banktransactions.read",
    "accounting.manualjournals.read", "accounting.contacts.read", "accounting.settings.read",
    "accounting.reports.aged.read", "accounting.reports.balancesheet.read", "accounting.reports.profitandloss.read",
    "accounting.reports.trialbalance.read", "payroll.employees.read", "payroll.settings.read", "payroll.timesheets.read"]))
    .resolves.toBeUndefined();
});
