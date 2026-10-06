import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { readdir } from "node:fs/promises";
import { configuredWritableTenantIds, runWithTenantPermissions, runWithXeroClient, TenantXeroClient } from "../xero-client.js";
import { updateXeroTrackingOption } from "../../handlers/update-xero-tracking-options.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import type { ToolDefinition } from "../../types/tool-definition.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

const writable = "11111111-1111-4111-8111-111111111111";
const readOnly = ["77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"];
const all = [writable, ...readOnly];
const received: { method?: string; tenant?: string }[] = [];
const fixture = createServer((request, response) => {
  received.push({ method: request.method, tenant: request.headers["xero-tenant-id"] as string });
  request.resume();
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ TrackingCategories: [{ Options: [{ TrackingOptionID: writable, Name: "Original" }] }] }));
});
let basePath: string;
beforeAll(async () => {
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  basePath = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
});
afterAll(async () => { fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve())); });
beforeEach(() => {
  received.length = 0;
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", all.join(","));
  vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [writable]: "read-write", ...Object.fromEntries(readOnly.map(id => [id, "read-only"])) }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function client(id: string) {
  const selected = new TenantXeroClient(id, { getTokenSet: async () => ({ access_token: "synthetic-fixture" }) });
  selected.setTokenSet({ access_token: "synthetic-fixture" });
  for (const api of [selected.accountingApi, selected.assetApi, selected.filesApi, selected.projectApi,
    selected.payrollAUApi, selected.bankFeedsApi, selected.payrollUKApi, selected.payrollNZApi,
    selected.appStoreApi, selected.financeApi]) api.basePath = basePath;
  return selected;
}
const request = <T>(callback: () => T, writes = [writable], reads = all) => runWithTenantPermissions(reads, callback, writes);
const routes: [string, (c: TenantXeroClient, id: string) => Promise<unknown>][] = [
  ["accounting PUT", (c, id) => c.accountingApi.createAccount(id, {})],
  ["accounting POST", (c, id) => c.accountingApi.updateContact(id, writable, { contacts: [] })],
  ["assets", (c, id) => c.assetApi.createAsset(id, {})],
  ["files", (c, id) => c.filesApi.createFileAssociation(id, writable, {})],
  ["projects", (c, id) => c.projectApi.createProject(id, {})],
  ["bank feeds", (c, id) => c.bankFeedsApi.createFeedConnections(id, { items: [] })],
  ["AU payroll approval", (c, id) => c.payrollAUApi.approveLeaveApplication(id, writable)],
  ["UK payroll approval", (c, id) => c.payrollUKApi.approveTimesheet(id, writable)],
  ["NZ payroll approval", (c, id) => c.payrollNZApi.approveTimesheet(id, writable)],
  ["NZ payroll DELETE", (c, id) => c.payrollNZApi.deleteTimesheet(id, writable)],
];

it("defaults every company to read-only and rejects malformed or foreign policy entries", () => {
  vi.stubEnv("XERO_TENANT_ACCESS_JSON", "{}"); expect(configuredWritableTenantIds()).toEqual([]);
  for (const policy of ["null", "[]", JSON.stringify({ [writable]: "write" }), JSON.stringify({ "not-a-uuid": "read-write" }), JSON.stringify({ "99999999-9999-4999-8999-999999999999": "read-write" })]) {
    vi.stubEnv("XERO_TENANT_ACCESS_JSON", policy); expect(() => configuredWritableTenantIds()).toThrow();
  }
});

it.each(routes)("blocks %s for both read-only companies before transport, even with attempted request write authority", async (_name, invoke) => {
  for (const id of readOnly) await expect(request(() => invoke(client(id), id), all)).rejects.toThrow("read-only");
  expect(received).toEqual([]);
});

it("allows authenticated write intent only for the read-write company and isolates concurrent read/write requests", async () => {
  await expect(client(writable).accountingApi.createAccount(writable, {})).rejects.toThrow("request write permission");
  await expect(request(() => client(writable).accountingApi.createAccount(writable, {}), [])).rejects.toThrow("request write permission");
  await expect(request(() => client(writable).accountingApi.createAccount(writable, {}), [writable], readOnly)).rejects.toThrow("not allowed");
  await Promise.all([
    request(() => client(writable).accountingApi.createAccount(writable, {})),
    ...readOnly.map(id => request(() => client(id).accountingApi.getAccounts(id), [])),
    request(() => client(readOnly[0]).financeApi.getCashValidation(readOnly[0]), []),
    expect(request(() => client(writable).accountingApi.createAccount(writable, {}), [])).rejects.toThrow("request write permission"),
  ]);
  expect(received).toHaveLength(4);
  expect(received.filter(entry => entry.method !== "GET")).toEqual([{ method: "PUT", tenant: writable }]);
});

it("rejects cross-tenant SDK arguments, overriding headers and tenantless app-store mutations", async () => {
  const selected = client(writable);
  await expect(request(() => selected.accountingApi.createAccount(readOnly[0], {}))).rejects.toThrow("must match");
  for (const headers of [{ "xero-tenant-id": readOnly[0] }, { "Xero-Tenant-Id": readOnly[0] }]) {
    await expect(request(() => selected.accountingApi.createAccount(writable, {}, undefined, { headers }))).rejects.toThrow("must match");
  }
  await expect(request(() => selected.accountingApi.getAccounts(readOnly[0]))).rejects.toThrow("must match");
  await expect(request(() => selected.appStoreApi.postUsageRecords(writable, writable, {}))).rejects.toThrow("must match");
  expect(received).toEqual([]);
});

it("guards an indirect read-then-update tracking route without mutating the read-only company", async () => {
  const selected = client(readOnly[0]);
  vi.spyOn(selected, "authenticate").mockResolvedValue(undefined);
  const result = await request(() => runWithXeroClient(selected, () => updateXeroTrackingOption(writable, [{ trackingOptionId: writable, name: "Changed" }])), all);
  expect(result).toMatchObject({ isError: true });
  expect(received).toEqual([{ method: "GET", tenant: readOnly[0] }]);
});

it("declares every existing create/update/delete tool as a shared-policy mutation and denies it before its handler", async () => {
  for (const directory of ["create", "update", "delete"]) {
    const base = new URL(`../../tools/${directory}/`, import.meta.url);
    for (const name of await readdir(base)) {
      if (!name.endsWith(".ts")) continue;
      const module = await import(new URL(name, base).href) as { default?: () => ToolDefinition<ZodRawShapeCompat> };
      if (!module.default) continue;
      const tool = module.default();
      expect(tool.access, tool.name).toBe("write");
      for (const tenantId of readOnly) {
        const result = await request(() => tool.handler({ tenantId }, {} as never), all);
        expect(result, tool.name).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("read-only") }] });
      }
    }
  }
  expect(received).toEqual([]);
});


it("prevents a declared read tool from mutating even when its caller has write permission", async () => {
  vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "synthetic-fixture");
  const selected = client(writable);
  const tool = CreateXeroTool({
    name: "arbitrary-name", description: "Read contract", access: "read", schema: {},
    handler: async () => {
      await selected.accountingApi.createAccount(writable, {});
      return { content: [] };
    },
  })();
  const result = await request(() => tool.handler({ tenantId: writable }, {} as never));
  expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("request write permission") }] });
  expect(received).toEqual([]);
  // Read invocation scope must not remove the caller's subsequent authorized write.
  await request(() => selected.accountingApi.createAccount(writable, {}));
  expect(received).toEqual([{ method: "PUT", tenant: writable }]);
});
