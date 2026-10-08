import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { XeroClient } from "xero-node";
import axios from "axios";
import { xeroEndpointScopeOptions } from "../../auth/xero-scopes.js";
import { runWithReadOnlyAccess, runWithTenantPermissions, runWithXeroClient, TenantXeroClient } from "../../clients/xero-client.js";
import { configuredPayrollRegion, nzOnlyPayrollTools, type PayrollRegion } from "../region.js";
import { createXeroPayrollTimesheet } from "../../handlers/create-xero-payroll-timesheet.handler.js";
import { getXeroPayrollTimesheet } from "../../handlers/get-xero-payroll-timesheet.handler.js";
import { listXeroPayrollTimesheets } from "../../handlers/list-xero-timesheets.handler.js";
import { listXeroPayrollEmployees } from "../../handlers/list-xero-payroll-employees.handler.js";
import { listXeroPayrollLeaveTypes } from "../../handlers/list-xero-payroll-leave-types.handler.js";
import { listXeroPayrollEmployeeLeaveBalances } from "../../handlers/list-xero-payroll-employee-leave-balances.handler.js";
import { listXeroPayrollEmployeeLeave } from "../../handlers/list-xero-payroll-employee-leave.handler.js";
import { listXeroPayrollEmployeeLeaveTypes } from "../../handlers/list-xero-payroll-employee-leave-types.handler.js";
import { listXeroPayrollLeavePeriods } from "../../handlers/list-xero-payroll-leave-periods.handler.js";
import { approveXeroPayrollTimesheet } from "../../handlers/approve-xero-payroll-timesheet.handler.js";
import { revertXeroPayrollTimesheet } from "../../handlers/revert-xero-payroll-timesheet.handler.js";
import { deleteXeroPayrollTimesheet } from "../../handlers/delete-xero-payroll-timesheet.handler.js";
import { updateXeroPayrollTimesheetAddLine } from "../../handlers/update-xero-payroll-timesheet-add-line.handler.js";
import { updateXeroPayrollTimesheetUpdateLine } from "../../handlers/update-xero-payroll-timesheet-update-line.handler.js";
import { ToolCatalog } from "../../tools/index.js";
import CreateTimesheetTool from "../../tools/create/create-payroll-timesheet.tool.js";
import GetTimesheetTool from "../../tools/get/get-payroll-timesheet.tool.js";
import ListEmployeesTool from "../../tools/list/list-payroll-employees.tool.js";
import ListBalancesTool from "../../tools/list/list-payroll-employee-leave-balances.tool.js";
import AddLineTool from "../../tools/update/update-payroll-timesheet-add-line.tool.js";
import UpdateLineTool from "../../tools/update/update-payroll-timesheet-update-line.tool.js";

const tenant = "11111111-1111-4111-8111-111111111111";
const employee = "22222222-2222-4222-8222-222222222222";
const sheet = "33333333-3333-4333-8333-333333333333";
const common = { employeeID: employee, startDate: "2026-10-05", endDate: "2026-10-06" };
const nzInput = { ...common, payrollCalendarID: tenant, timesheetLines: [{ earningsRateID: tenant, numberOfUnits: 8, date: "2026-10-05" }] };
const auInput = { ...nzInput, timesheetLines: [{ ...nzInput.timesheetLines[0], trackingItemID: employee }] };
const auLine = { ...auInput.timesheetLines[0], timesheetLineID: tenant, numberOfUnits: 0 };
const auSheet = { ...auInput, timesheetID: sheet, status: "Draft", totalHours: 0, timesheetLines: [auLine] };
const nzSheet = { ...nzInput, timesheetID: sheet, totalHours: 0 };
const line = nzInput.timesheetLines[0];
const regionApiPath = (region: PayrollRegion) => region === "AU" ? "/payroll.xro/1.0" : "/payroll.xro/2.0";
const timesheetPath = "/payroll.xro/2.0/Timesheets";
const v2Body = (body: Record<string, unknown>) => ({ httpStatusCode: "OK", problem: null, ...body });
const sendHttpRequest = axios.request.bind(axios);

beforeEach(() => {
  vi.stubEnv("XERO_PAYROLL_REGION", "NZ");
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenant);
  vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "synthetic-fixture");
  vi.stubEnv("XERO_TOKEN_FILE", "");
  vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenant]: "read-write" }));
  vi.spyOn(XeroClient.prototype, "updateTenants").mockImplementation(async function () {
    Object.defineProperty(this, "tenants", { value: [{ tenantId: tenant }] });
    return this.tenants;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

interface CapturedRequest { path: string; method: string; body: unknown; tenant: string | undefined; authorization: string | undefined }
interface FixtureReply { status?: number; body: unknown; headers?: Record<string, string> }
async function fixture<T>(region: PayrollRegion, callback: (client: TenantXeroClient, requests: CapturedRequest[]) => Promise<T>,
  reply?: (path: string, method: string) => FixtureReply, scope: string | undefined = "payroll.employees.read payroll.settings.read payroll.timesheets") {
  const defaultReply = (path: string, method: string) => {
    if (path === "/payroll.xro/1.0/Employees") return { body: { Employees: [{ EmployeeID: employee, FirstName: "Alex", LastName: "Fixture", Phone: "AU-PHONE" }] } };
    if (path === `/payroll.xro/1.0/Employees/${employee}`) return { body: { Employees: [{ EmployeeID: employee, LeaveBalances: [{ LeaveTypeID: sheet, LeaveName: "Annual", NumberOfUnits: 0, TypeOfUnits: "Hours" }] }] } };
    if (path === "/payroll.xro/1.0/PayItems") return { body: { PayItems: { LeaveTypes: [{ LeaveTypeID: sheet, Name: "Annual", CurrentRecord: true }] } } };
    if (region === "AU" && path.startsWith(timesheetPath)) {
      if (method === "DELETE") return { body: v2Body({}) };
      if (path.includes("/Lines")) return { body: v2Body({ timesheetLine: auLine }) };
      if (path.endsWith("/Approve")) return { body: v2Body({ timesheet: { ...auSheet, status: "Approved" } }) };
      if (path === timesheetPath && method === "GET") return { body: v2Body({ timesheets: [auSheet] }) };
      return { body: v2Body({ timesheet: auSheet }) };
    }
    if (path === "/payroll.xro/2.0/Employees") return { body: { employees: [{ employeeID: employee, firstName: "Alex", phoneNumber: "NZ-PHONE" }] } };
    if (path === "/payroll.xro/2.0/LeaveTypes") return { body: { leaveTypes: [{ leaveTypeID: sheet, name: "Annual", isActive: true }] } };
    if (path === `/payroll.xro/2.0/Employees/${employee}/LeaveBalances`) return { body: { leaveBalances: [{ leaveTypeID: sheet, name: "Annual", balance: 0 }] } };
    if (path === "/payroll.xro/2.0/Timesheets" && method !== "GET") return { body: { timesheet: nzSheet } };
    if (path === "/payroll.xro/2.0/Timesheets") return { body: { timesheets: [nzSheet] } };
    if (path === `/payroll.xro/2.0/Timesheets/${sheet}`) return { body: { timesheet: nzSheet } };
    if (path === `${timesheetPath}/${sheet}/Approve` || path === `${timesheetPath}/${sheet}/RevertToDraft`) return { body: { timesheet: nzSheet } };
    if (path.includes("/Lines")) return { body: { timesheetLine: { ...line, timesheetLineID: tenant } } };
    return { status: 500, body: { message: "Unexpected fixture route" } };
  };
  vi.stubEnv("XERO_PAYROLL_REGION", region);
  const requests: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    const path = new URL(request.url!, "http://fixture.test").pathname;
    requests.push({ path, method: request.method!, body: raw ? JSON.parse(raw) : undefined, tenant: request.headers["xero-tenant-id"] as string | undefined, authorization: request.headers.authorization });
    const result: FixtureReply = (reply ?? defaultReply)(path, request.method!);
    response.writeHead(result.status ?? 200, { "Content-Type": "application/json", ...result.headers });
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Production AU v2 origin is fixed. Rewrite only the outbound test transport;
  // the adapter still constructs the official URL and forbids credential redirects.
  const transport = vi.spyOn(axios, "request").mockImplementation(config => {
    if (config.url?.startsWith("https://api.xero.com/payroll.xro/2.0/")) {
      expect(config.maxRedirects).toBe(0);
      return sendHttpRequest({ ...config, url: config.url.replace("https://api.xero.com", base) });
    }
    return sendHttpRequest(config);
  });
  const selected = new TenantXeroClient(tenant, { getTokenSet: async () => ({ access_token: "synthetic-fixture",
    scope }) });
  selected.payrollAUApi.basePath = `${base}${regionApiPath("AU")}`;
  selected.payrollNZApi.basePath = `${base}${regionApiPath("NZ")}`;
  selected.payrollUKApi.basePath = `${base}/UK`;
  try {
    return await runWithTenantPermissions([tenant], () => runWithXeroClient(selected, () => callback(selected, requests)), [tenant]);
  } finally {
    transport.mockRestore();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe("payroll region configuration", () => {
  it("uses the official regional SDK base paths; fixtures preserve those path prefixes", () => {
    const selected = new TenantXeroClient(tenant, { getTokenSet: vi.fn() });
    expect(selected.payrollAUApi.basePath).toBe("https://api.xero.com/payroll.xro/1.0");
    expect(selected.payrollNZApi.basePath).toBe("https://api.xero.com/payroll.xro/2.0");
    expect(selected.payrollAUv2Api.basePath).toBe("https://api.xero.com/payroll.xro/2.0");
  });
  it("defaults only an omitted variable to NZ and snapshots clients", () => {
    vi.stubEnv("XERO_PAYROLL_REGION", undefined);
    expect(configuredPayrollRegion()).toBe("NZ");
    const selected = new TenantXeroClient(tenant, { getTokenSet: vi.fn() });
    vi.stubEnv("XERO_PAYROLL_REGION", "AU");
    expect(configuredPayrollRegion()).toBe("AU");
    expect(selected.payrollRegion).toBe("NZ");
  });
  it.each(["", "UK", "US", "au", " AU ", "https://api.xero.com"])("rejects unsupported config %s", value => {
    vi.stubEnv("XERO_PAYROLL_REGION", value);
    expect(configuredPayrollRegion).toThrow("XERO_PAYROLL_REGION must be NZ or AU");
    expect(() => CreateTimesheetTool()).toThrow("XERO_PAYROLL_REGION");
    expect(() => new TenantXeroClient(tenant, { getTokenSet: vi.fn() })).toThrow("XERO_PAYROLL_REGION");
  });
});

it.each(["NZ", "AU"] as const)("dispatches supported %s reads and preserves regional response fields", async region => {
  await fixture(region, async (client, requests) => {
    const foreign = region === "AU" ? client.payrollNZApi : client.payrollAUv2Api;
    const calls = [vi.spyOn(foreign, "getTimesheets"), vi.spyOn(foreign, "getTimesheet")];
    expect(await listXeroPayrollEmployees()).toMatchObject({ isError: false, result: [{ employeeID: employee }] });
    expect(await listXeroPayrollTimesheets()).toMatchObject({ isError: false, result: [{ timesheetID: sheet }] });
    expect(await getXeroPayrollTimesheet(sheet)).toMatchObject({ isError: false, result: { timesheetID: sheet,
      timesheetLines: region === "AU" ? [auLine] : nzInput.timesheetLines } });
    expect(await listXeroPayrollLeaveTypes()).toMatchObject({ isError: false, result: [{ leaveTypeID: sheet, name: "Annual" }] });
    expect(await listXeroPayrollEmployeeLeaveBalances(employee)).toMatchObject({ isError: false, result: [{ name: "Annual", balance: 0 }] });
    expect(requests).toHaveLength(5);
    expect(requests.every(request => request.method === "GET" && request.tenant === tenant && request.authorization === "Bearer synthetic-fixture")).toBe(true);
    expect(requests.map(request => request.path)).toEqual([
      `${regionApiPath(region)}/Employees`, timesheetPath, `${timesheetPath}/${sheet}`,
      `${regionApiPath(region)}/${region === "AU" ? "PayItems" : "LeaveTypes"}`,
      region === "AU" ? `/payroll.xro/1.0/Employees/${employee}` : `/payroll.xro/2.0/Employees/${employee}/LeaveBalances`,
    ]);
    expect(requests[3].path).toBe(`${regionApiPath(region)}/${region === "AU" ? "PayItems" : "LeaveTypes"}`);
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });
});

it.each(["NZ", "AU"] as const)("serializes %s creation with its official regional contract", async region => {
  await fixture(region, async (client, requests) => {
    const foreign = vi.spyOn(region === "AU" ? client.payrollNZApi : client.payrollAUv2Api, "createTimesheet");
    const input = region === "AU" ? auInput : nzInput;
    expect(await createXeroPayrollTimesheet(input)).toMatchObject({ isError: false, result: { timesheetID: sheet } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: timesheetPath, method: "POST", tenant });
    expect(requests[0].body).toEqual(input);
    expect(foreign).not.toHaveBeenCalled();
  });
});

it("publishes AU v2 calendar and dated scalar-line schemas, rejecting v1 arrays before authentication", async () => {
  for (const region of ["NZ", "AU"] as const) {
    vi.stubEnv("XERO_PAYROLL_REGION", region);
    const schema = z.object(CreateTimesheetTool().schema);
    expect(schema.safeParse({ ...(region === "AU" ? auInput : nzInput), tenantId: tenant }).success).toBe(true);
    expect(schema.safeParse({ ...auInput, timesheetLines: [{ earningsRateID: tenant, numberOfUnits: [8, 0] }], tenantId: tenant }).success).toBe(false);
  }
  await fixture("AU", async (client, requests) => {
    const authenticate = vi.spyOn(client, "authenticate");
    for (const input of [{ ...auInput, payrollCalendarID: undefined }, { ...auInput, timesheetLines: [{ ...auInput.timesheetLines[0], numberOfUnits: [8] }] }, { ...auInput, startDate: "2026-02-30" }, { ...auInput, timesheetLines: [{ ...auInput.timesheetLines[0], date: "2026-10-04" }] }, { ...auInput, endDate: "2026-10-04" }]) {
      expect(await createXeroPayrollTimesheet(input)).toMatchObject({ isError: true });
    }
    expect(authenticate).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });
});

it("formats AU hours, employee phone and zero leave units without NZ assumptions", async () => {
  await fixture("AU", async client => {
    // Tool wrappers create their own shared tenant clients; use this fixture for their SDKs.
    vi.spyOn(TenantXeroClient.prototype, "authenticate").mockImplementation(async function () {
      this.payrollAUApi.basePath = client.payrollAUApi.basePath;
      this.setTokenSet({ access_token: "synthetic-fixture" });
    });
    const timesheet = await GetTimesheetTool().handler({ tenantId: tenant, timesheetID: sheet }, {} as never);
    expect(JSON.stringify(timesheet)).toContain("Total Hours: 0");
    const employees = await ListEmployeesTool().handler({ tenantId: tenant }, {} as never);
    expect(JSON.stringify(employees)).toContain("Phone: AU-PHONE");
    const balances = await ListBalancesTool().handler({ tenantId: tenant, employeeId: employee }, {} as never);
    expect(JSON.stringify(balances)).toContain("Current Balance: 0");
  });
});

it("returns honest AU unsupported errors at both tool and handler layers without authentication or fallback", async () => {
  await fixture("AU", async (client, requests) => {
    const authenticate = vi.spyOn(TenantXeroClient.prototype, "authenticate");
    expect([...nzOnlyPayrollTools]).toEqual(["list-payroll-employee-leave", "list-payroll-employee-leave-types", "list-payroll-leave-periods"]);
    for (const build of ToolCatalog) {
      const tool = build();
      if (["add-timesheet-line", "update-timesheet-line", "approve-timesheet", "revert-timesheet", "delete-timesheet"].includes(tool.name)) expect(tool.description).not.toContain("Unsupported in AU");
      if (!nzOnlyPayrollTools.has(tool.name)) continue;
      expect(tool.description).toContain("Unsupported in AU");
      expect(await tool.handler({ tenantId: tenant }, {} as never)).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("not supported") }] });
    }
    const operations = [() => listXeroPayrollEmployeeLeave(employee), () => listXeroPayrollEmployeeLeaveTypes(employee),
      () => listXeroPayrollLeavePeriods(employee)];
    for (const operation of operations) expect(await operation()).toMatchObject({ isError: true, error: expect.stringContaining("no NZ fallback") });
    expect(authenticate).not.toHaveBeenCalled();
    expect(client.payrollRegion).toBe("AU");
    expect(requests).toEqual([]);
  });
});

it.each(["NZ", "AU"] as const)("blocks indirect cross-region SDK routes with %s selected", async region => {
  await fixture(region, async (client, requests) => {
    await client.authenticate();
    const foreign = region === "AU" ? client.payrollNZApi : client.payrollAUApi;
    await expect(foreign.getTimesheets(tenant)).rejects.toThrow("cross-region requests are disabled");
    await expect(client.payrollUKApi.getTimesheets(tenant)).rejects.toThrow("cross-region requests are disabled");
    if (region === "NZ") await expect(client.payrollAUv2Api.getTimesheets()).rejects.toThrow("cross-region requests are disabled");
    else await expect(client.payrollAUApi.getTimesheets(tenant)).rejects.toThrow("AU Timesheets 1.0 is disabled");
    expect(requests).toEqual([]);
  });
});

const timesheetMutations = [
  ["add", "POST", `/Timesheets/${sheet}/Lines`, () => updateXeroPayrollTimesheetAddLine(sheet, line), "timesheetLine"],
  ["update", "PUT", `/Timesheets/${sheet}/Lines/${tenant}`, () => updateXeroPayrollTimesheetUpdateLine(sheet, tenant, line), "timesheetLine"],
  ["approve", "POST", `/Timesheets/${sheet}/Approve`, () => approveXeroPayrollTimesheet(sheet), "timesheet"],
  ["revert", "POST", `/Timesheets/${sheet}/RevertToDraft`, () => revertXeroPayrollTimesheet(sheet), "timesheet"],
  ["delete", "DELETE", `/Timesheets/${sheet}`, () => deleteXeroPayrollTimesheet(sheet), "deleted"],
] as const;

it.each((["NZ", "AU"] as const).flatMap(region => timesheetMutations.map(operation => [region, ...operation] as const)))("dispatches %s %s using the selected contract and exact method", async (region, _name, method, path, invoke, resource) => {
  await fixture(region, async (client, requests) => {
    const foreign = region === "AU" ? client.payrollNZApi : client.payrollAUv2Api;
    const foreignCalls = [vi.spyOn(foreign, "approveTimesheet"), vi.spyOn(foreign, "revertTimesheet"), vi.spyOn(foreign, "deleteTimesheet"), vi.spyOn(foreign, "createTimesheetLine"), vi.spyOn(foreign, "updateTimesheetLine")];
    const result = await invoke();
    expect(result).toMatchObject({ isError: false, result: resource === "deleted" ? true : resource === "timesheet" ? { timesheetID: sheet } : { timesheetLineID: tenant, numberOfUnits: region === "AU" ? 0 : 8 } });
    if (region === "AU" && resource === "timesheet") expect(result).toMatchObject({ result: { status: _name === "approve" ? "Approved" : "Draft", totalHours: 0 } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method, path: `/payroll.xro/2.0${path}`, tenant, authorization: "Bearer synthetic-fixture" });
    expect(requests[0].body).toEqual(resource === "timesheetLine" ? line : region === "NZ" ? {} : undefined);
    for (const call of foreignCalls) expect(call).not.toHaveBeenCalled();
  });
});

it("serializes AU tracking items in both line tools and reports provider receipts", async () => {
  await fixture("AU", async (_client, requests) => {
    vi.spyOn(TenantXeroClient.prototype, "authenticate").mockImplementation(async function () {
      this.setTokenSet({ access_token: "synthetic-fixture" });
    });
    const input = { ...line, numberOfUnits: 0, trackingItemID: employee };
    expect(await AddLineTool({ access: { company: ["read", "write"], connection: [] } }).handler({ tenantId: tenant, timesheetID: sheet, timesheetLine: input }, {} as never)).not.toHaveProperty("isError", true);
    expect(await UpdateLineTool({ access: { company: ["read", "write"], connection: [] } }).handler({ tenantId: tenant, timesheetID: sheet, timesheetLineID: tenant, timesheetLine: input }, {} as never)).not.toHaveProperty("isError", true);
    expect(requests.map(request => request.body)).toEqual([input, input]);
  });
});

it.each(timesheetMutations)("applies tenant, scope and request write authorization to AU %s", async (_name, _method, _path, invoke) => {
  for (const denial of ["company", "request", "read-tool", "tenant"]) {
    await fixture("AU", async (_client, requests) => {
      if (denial === "company") vi.stubEnv("XERO_TENANT_ACCESS_JSON", "{}");
      const result = denial === "request" ? await runWithTenantPermissions([tenant], invoke)
        : denial === "read-tool" ? await runWithReadOnlyAccess(invoke)
        : denial === "tenant" ? await runWithTenantPermissions([], invoke) : await invoke();
      expect(result).toMatchObject({ isError: true });
      expect(requests).toEqual([]);
    });
    vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenant]: "read-write" }));
  }
  await fixture("AU", async (_client, requests) => {
    expect(await invoke()).toMatchObject({ isError: true, error: expect.stringContaining("payroll.timesheets") });
    expect(requests).toEqual([]);
  }, undefined, "payroll.timesheets.read");
});

it.each([401, 403, 404, 500])("does not fall back to AU v1 or NZ after AU v2 fails (%s)", async status => {
  await fixture("AU", async (client, requests) => {
    const nz = vi.spyOn(client.payrollNZApi, "getTimesheets");
    const auV1 = vi.spyOn(client.payrollAUApi, "getTimesheets");
    expect(await listXeroPayrollTimesheets()).toMatchObject({ isError: true });
    expect(requests.map(request => request.path)).toEqual([timesheetPath]);
    expect(nz).not.toHaveBeenCalled();
    expect(auV1).not.toHaveBeenCalled();
  }, () => ({ status, body: { problem: { title: "Synthetic failure" } } }));
});

it.each(timesheetMutations)("rejects AU %s malformed and problem responses without fallback", async (_name, _method, _path, invoke) => {
  for (const body of [{}, { httpStatusCode: "OK", problem: { title: "Rejected" } }, v2Body({ timesheet: null, timesheetLine: null })]) {
    // DELETE has no resource receipt; a valid OK/non-problem envelope is sufficient.
    if (_name === "delete" && body.httpStatusCode === "OK" && body.problem === null) continue;
    await fixture("AU", async (_client, requests) => {
      expect(await invoke()).toMatchObject({ isError: true });
      expect(requests).toHaveLength(1);
    }, () => ({ body }));
  }
});

it("rejects AU v1 and invalid AU line payloads before authentication", async () => {
  await fixture("AU", async (client, requests) => {
    const authenticate = vi.spyOn(client, "authenticate");
    for (const input of [{ ...line, numberOfUnits: [8, 0] }, { ...line, date: "2026-02-30" }, { ...line, earningsRateID: "invalid" }]) {
      expect(await updateXeroPayrollTimesheetAddLine(sheet, input as never)).toMatchObject({ isError: true });
      expect(await updateXeroPayrollTimesheetUpdateLine(sheet, tenant, input as never)).toMatchObject({ isError: true });
    }
    expect(authenticate).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });
});

it("prevents AU bearer redirects and keeps the provider origin fixed", async () => {
  await fixture("AU", async (client, requests) => {
    expect(client.payrollAUv2Api.basePath).toBe("https://api.xero.com/payroll.xro/2.0");
    expect(() => { Object.assign(client.payrollAUv2Api, { basePath: "https://untrusted.example" }); }).toThrow();
    expect(await listXeroPayrollTimesheets()).toMatchObject({ isError: true });
    expect(requests.map(request => request.path)).toEqual([timesheetPath]);
  }, () => ({ status: 302, body: {}, headers: { Location: "/credentials-must-not-follow" } }));
});

it("authenticates AU v2 against the same connected-tenant grant before transport", async () => {
  vi.mocked(XeroClient.prototype.updateTenants).mockImplementation(async function () {
    Object.defineProperty(this, "tenants", { value: [{ tenantId: employee }] });
    return this.tenants;
  });
  await fixture("AU", async (_client, requests) => {
    expect(await listXeroPayrollTimesheets()).toMatchObject({ isError: true, error: expect.stringContaining("not connected") });
    expect(requests).toEqual([]);
  });
});

it("rejects substitution of AU timesheet, employee, calendar and line identifiers", async () => {
  const cases = [
    [() => createXeroPayrollTimesheet(auInput), v2Body({ timesheet: { ...auSheet, employeeID: tenant } })],
    [() => createXeroPayrollTimesheet(auInput), v2Body({ timesheet: { ...auSheet, payrollCalendarID: employee } })],
    [() => getXeroPayrollTimesheet(sheet), v2Body({ timesheet: { ...auSheet, timesheetID: tenant } })],
    [() => approveXeroPayrollTimesheet(sheet), v2Body({ timesheet: { ...auSheet, timesheetID: tenant } })],
    [() => updateXeroPayrollTimesheetUpdateLine(sheet, tenant, line), v2Body({ timesheetLine: { ...auLine, timesheetLineID: sheet } })],
  ] as const;
  for (const [invoke, body] of cases) await fixture("AU", async (_client, requests) => {
    expect(await invoke()).toMatchObject({ isError: true, error: expect.stringContaining("different") });
    expect(requests).toHaveLength(1);
  }, () => ({ body }));
});

it.each((["NZ", "AU"] as const).flatMap(region => [401, 403, 404, 500].map(status => [region, status] as const)))("never retries %s payroll failures (%s) against another region", async (region, status) => {
  await fixture(region, async (_client, requests) => {
    expect(await listXeroPayrollEmployees()).toMatchObject({ isError: true });
    expect(requests.map(request => request.path)).toEqual([`${regionApiPath(region)}/Employees`]);
  }, () => ({ status, body: { message: "Synthetic regional provider rejection" } }));
});

it("never substitutes another employee's AU balance response", async () => {
  await fixture("AU", async (_client, requests) => {
    expect(await listXeroPayrollEmployeeLeaveBalances(employee)).toMatchObject({ isError: true, error: expect.stringContaining("requested employee") });
    expect(requests).toHaveLength(1);
  }, () => ({ body: { Employees: [{ EmployeeID: tenant, LeaveBalances: [{ NumberOfUnits: 100 }] }] } }));
});

it("preserves shared company and request write policy for AU creation", async () => {
  await fixture("AU", async (_client, requests) => {
    vi.stubEnv("XERO_TENANT_ACCESS_JSON", "{}");
    expect(await createXeroPayrollTimesheet(auInput)).toMatchObject({ isError: true, error: expect.stringContaining("read-only") });
    vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenant]: "read-write" }));
    const result = await runWithTenantPermissions([tenant], () => createXeroPayrollTimesheet(auInput));
    expect(result).toMatchObject({ isError: true, error: expect.stringContaining("request write permission") });
    expect(requests).toEqual([]);
  });
});

const auReadOperations = [
  ["employees", "payroll.employees", "/Employees", () => listXeroPayrollEmployees()],
  ["employee balances", "payroll.employees", `/Employees/${employee}`, () => listXeroPayrollEmployeeLeaveBalances(employee)],
  ["leave settings", "payroll.settings", "/PayItems", () => listXeroPayrollLeaveTypes()],
  ["timesheets", "payroll.timesheets", "/Timesheets", () => listXeroPayrollTimesheets()],
] as const;

it.each(auReadOperations)("checks AU %s through the shared scope resolver before transport", async (_name, base, path, invoke) => {
  expect(xeroEndpointScopeOptions("payrollAU", path, true)).toEqual([`${base}.read`, base]);
  await fixture("AU", async (_client, requests) => {
    expect(await invoke()).toMatchObject({ isError: true, error: expect.stringContaining(`${base}.read`) });
    expect(requests).toEqual([]);
  }, undefined, "offline_access");
});

it.each(auReadOperations)("accepts read or manage consent for AU %s without new scope families", async (_name, base, _path, invoke) => {
  for (const scope of [`${base}.read`, base]) {
    await fixture("AU", async (_client, requests) => {
      expect(await invoke()).toMatchObject({ isError: false });
      expect(requests).toHaveLength(1);
    }, undefined, scope);
  }
});

it("never elevates AU timesheet read consent to creation even with company write authority", async () => {
  expect(xeroEndpointScopeOptions("payrollAU", "/Timesheets", false)).toEqual(["payroll.timesheets"]);
  await fixture("AU", async (_client, requests) => {
    expect(await createXeroPayrollTimesheet(auInput)).toMatchObject({ isError: true, error: expect.stringContaining("payroll.timesheets") });
    expect(requests).toEqual([]);
  }, undefined, "payroll.timesheets.read");
});

it.each([
  v2Body({}),
  v2Body({ timesheet: { employeeID: employee } }),
  { httpStatusCode: "BadRequest", problem: { detail: "Rejected fixture" }, timesheet: null },
  { Timesheets: [{ EmployeeID: employee, TimesheetID: sheet }] },
  v2Body({ timesheet: { ...auSheet, timesheetLines: [{ earningsRateID: tenant, numberOfUnits: [8, 0] }] } }),
])("does not report AU creation success for a missing receipt or validation rejection", async body => {
  await fixture("AU", async (_client, requests) => {
    expect(await createXeroPayrollTimesheet(auInput)).toMatchObject({ isError: true, result: null, error: expect.stringContaining("Xero AU") });
    expect(requests.map(request => request.path)).toEqual([timesheetPath]);
  }, () => ({ body }));
});
