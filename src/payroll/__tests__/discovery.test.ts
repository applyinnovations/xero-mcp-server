import { afterEach, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { XeroMcpServer } from "../../server/xero-mcp-server.js";
import { ToolFactory } from "../../tools/tool-factory.js";
import { ToolCatalog } from "../../tools/index.js";
import { selectPayrollModule } from "../module.js";
import { TenantXeroClient } from "../../clients/xero-client.js";
import { NzPayrollClient } from "../nz/client.js";
import { AuPayrollClient } from "../au/client.js";

const tenant = "11111111-1111-4111-8111-111111111111";
const absent = [
  "list-payroll-employee-leave",
  "list-payroll-employee-leave-types",
  "list-payroll-leave-periods",
];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each(["NZ", "AU"] as const)(
  "publishes only %s-supported tools over the actual SDK stdio transport",
  async (region) => {
    vi.stubEnv("XERO_PAYROLL_REGION", region);
    vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenant);
    vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "synthetic-never-sent");
    vi.stubEnv("XERO_TOKEN_FILE", "");
    const provider = vi.fn(async () => ({
      access_token: "synthetic-never-sent",
    }));
    const authenticate = vi
      .spyOn(TenantXeroClient.prototype, "authenticate")
      .mockRejectedValue(new Error("Authentication must not happen"));
    const payroll = selectPayrollModule();
    const server = XeroMcpServer.GetServer();
    ToolFactory(
      server,
      {
        access: { company: ["read", "write"], connection: ["read", "write"] },
        tenantClientFactory: (id) =>
          new TenantXeroClient(id, { getTokenSet: provider }, payroll.region),
      },
      payroll,
    );
    // Opposing environment changes cannot replace the catalog already bound at startup.
    vi.stubEnv("XERO_PAYROLL_REGION", region === "NZ" ? "AU" : "NZ");
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new Client({ name: "regional-stdio-fixture", version: "1" });
    try {
      await server.connect(new StdioServerTransport(input, output));
      await client.connect(new StdioServerTransport(output, input));
      const tools = (await client.listTools()).tools;
      const definitions = ToolCatalog(payroll).map((build) => build());
      expect(tools.map((t) => t.name).sort()).toEqual(
        definitions.map((t) => t.name).sort(),
      );
      expect(tools).toHaveLength(region === "NZ" ? 58 : 55);
      expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
      for (const tool of tools)
        expect(tool.annotations?.readOnlyHint).toBe(
          definitions.find((d) => d.name === tool.name)!.access === "read",
        );
      const create = tools.find((t) => t.name === "create-timesheet")!;
      expect(create.description).toContain(
        region === "NZ" ? "New Zealand" : "Australian",
      );
      const shape = create.inputSchema.properties!.timesheetLines as {
        items: { properties: Record<string, unknown> };
      };
      expect(shape.items.properties).toHaveProperty("date");
      expect(Object.hasOwn(shape.items.properties, "trackingItemID")).toBe(
        region === "AU",
      );
      const schema = tools.find(
        (t) => t.name === "list-payroll-employee-leave-balances",
      )!;
      expect(schema.description).toContain(
        region === "AU" ? "leaveName" : "leave balances",
      );
      if (region === "AU")
        for (const name of absent) {
          expect(tools.map((t) => t.name)).not.toContain(name);
          expect(
            await client.callTool({
              name,
              arguments: { tenantId: tenant, employeeId: tenant },
            }),
          ).toHaveProperty("isError", true);
        }
      else
        for (const name of absent)
          expect(tools.map((t) => t.name)).toContain(name);
      expect(authenticate).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
      input.destroy();
      output.destroy();
    }
  },
);

it.each(["NZ", "AU"] as const)(
  "keeps %s registration permissions independent of regional selection",
  (region) => {
    const payroll = selectPayrollModule(region);
    const expected = { NZ: [28, 54, 58], AU: [25, 51, 55] }[region];
    for (const [index, access] of [
      { company: ["read"], connection: [] },
      { company: ["read", "write"], connection: [] },
      { company: ["read", "write"], connection: ["read", "write"] },
    ].entries()) {
      const server = XeroMcpServer.GetServer();
      const registered = vi.spyOn(server, "registerTool");
      ToolFactory(
        server,
        {
          access: access as {
            company: ("read" | "write")[];
            connection: ("read" | "write")[];
          },
        },
        payroll,
      );
      expect(registered).toHaveBeenCalledTimes(expected[index]);
    }
  },
);

it.each(["NZ", "AU"] as const)(
  "binds invocation clients to the selected %s module after environment changes",
  async (region) => {
    vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenant);
    vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "synthetic-never-sent");
    vi.stubEnv("XERO_TOKEN_FILE", "");
    const payroll = selectPayrollModule(region);
    const invoke = vi
      .spyOn(
        region === "NZ" ? NzPayrollClient.prototype : AuPayrollClient.prototype,
        region === "NZ" ? "getPayrollEmployees" : "employees",
      )
      .mockResolvedValue([]);
    const server = XeroMcpServer.GetServer();
    const registered = vi.spyOn(server, "registerTool");
    ToolFactory(server, undefined, payroll);
    vi.stubEnv("XERO_PAYROLL_REGION", region === "NZ" ? "AU" : "NZ");
    const handler = registered.mock.calls.find(
      ([name]) => name === "list-payroll-employees",
    )![2];
    expect(await handler({ tenantId: tenant }, {} as never)).not.toHaveProperty(
      "isError",
      true,
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  },
);
