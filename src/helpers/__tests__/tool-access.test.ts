import { expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { CreateTool } from "../create-tool.js";
import { CreateXeroTool } from "../create-xero-tool.js";
import { RegisterTool } from "../register-tool.js";
import type { ToolContext, ToolDefinition } from "../../types/tool-definition.js";
import { ToolFactory } from "../../tools/tool-factory.js";
import { ToolCatalog } from "../../tools/index.js";
import { CreateTools } from "../../tools/create/index.js";
import { UpdateTools } from "../../tools/update/index.js";
import { DeleteTools } from "../../tools/delete/index.js";
import { assertTenantWriteAccess, runWithTenantPermissions } from "../../clients/xero-client.js";

it("rejects missing or invalid access metadata before creating or registering a tool", () => {
  const server = new McpServer({ name: "classification-fixture", version: "1" });
  const registered = vi.spyOn(server, "registerTool");
  for (const access of [undefined, "", "admin"]) {
    const tool = { name: "unclassified", description: "Fixture", resource: "company", schema: {}, access, handler: async () => ({ content: [] }) } as unknown as ToolDefinition<ZodRawShapeCompat>;
    expect(() => CreateTool(() => tool)()).toThrow("explicitly declared");
    expect(() => CreateXeroTool(tool)()).toThrow("explicitly declared");
    expect(() => RegisterTool(server, tool)).toThrow("explicitly declared");
  }
  expect(registered).not.toHaveBeenCalled();
});

it("rejects missing or invalid resource metadata without guessing an authorization domain", () => {
  const server = new McpServer({ name: "resource-fixture", version: "1" });
  const registered = vi.spyOn(server, "registerTool");
  for (const resource of [undefined, "", "other"]) {
    const tool = { name: "unclassified", description: "Fixture", resource, schema: {}, access: "read", handler: async () => ({ content: [] }) } as unknown as ToolDefinition<ZodRawShapeCompat>;
    expect(() => CreateTool(() => tool)()).toThrow("explicitly declared");
    expect(() => RegisterTool(server, tool)).toThrow("explicitly declared");
  }
  expect(registered).not.toHaveBeenCalled();
});

it("derives MCP hints from explicit mutation access independently of names and resources", () => {
  const server = new McpServer({ name: "hint-fixture", version: "1" });
  const registered = vi.spyOn(server, "registerTool");
  RegisterTool(server, { name: "create-read-fixture", description: "Fixture", resource: "company", access: "read", schema: {}, handler: async () => ({ content: [] }) });
  RegisterTool(server, { name: "get-write-fixture", description: "Fixture", resource: "connection", access: "write", schema: {}, annotations: { destructiveHint: false }, handler: async () => ({ content: [] }) });
  expect(registered.mock.calls.map(([, metadata]) => metadata.annotations)).toEqual([
    { readOnlyHint: true }, { readOnlyHint: false, destructiveHint: false },
  ]);
});

it("keeps accounting CRUD inventory separate from the selected payroll module", () => {
  // Independent upstream inventory: category exports must not become runtime allowlists.
  expect(CreateTools.map(create => create().name).sort()).toEqual([
    "create-bank-transaction", "create-contact", "create-credit-note", "create-invoice",
    "create-item", "create-manual-journal", "create-payment", "create-quote",
    "create-tracking-category", "create-tracking-options",
  ]);
  expect(UpdateTools.map(create => create().name).sort()).toEqual([
    "code-bank-transaction",
    "update-bank-transaction", "update-contact", "update-credit-note", "update-invoice",
    "update-item", "update-manual-journal", "update-quote", "update-tracking-category",
    "update-tracking-options",
  ]);
  expect(DeleteTools.map(create => create().name)).toEqual([]);
});

it("registers every tool in the complete catalog once for full resource access", () => {
  const context: ToolContext = { access: { company: ["read", "write"], connection: ["read", "write"] } };
  const definitions = ToolCatalog().map(create => create(context));
  const server = new McpServer({ name: "catalog-fixture", version: "1" });
  const registered = vi.spyOn(server, "registerTool");
  ToolFactory(server, context);
  expect(definitions).toHaveLength(58);
  expect(new Set(definitions.map(tool => tool.name)).size).toBe(58);
  expect(registered).toHaveBeenCalledTimes(58);
  expect(new Set(registered.mock.calls.map(([name]) => name)).size).toBe(58);
  for (const [name, metadata] of registered.mock.calls) {
    const definition = definitions.find(tool => tool.name === name)!;
    expect(metadata.annotations?.readOnlyHint).toBe(definition.access === "read");
  }
});

it("keeps connection mutations independent of company write authority", async () => {
  const tenant = "11111111-1111-4111-8111-111111111111";
  vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenant);
  vi.stubEnv("XERO_TENANT_ACCESS_JSON", JSON.stringify({ [tenant]: "read-write" }));
  try {
    const server = new McpServer({ name: "resource-isolation-fixture", version: "1" });
    const registered = vi.spyOn(server, "registerTool");
    let connectionState = 0;
    RegisterTool(server, {
      name: "write-fixture", resource: "connection", access: "write", description: "Fixture", schema: {},
      handler: async () => { connectionState++; assertTenantWriteAccess(tenant); return { content: [] }; },
    });
    const invoke = registered.mock.calls[0][2] as ToolCallback<ZodRawShapeCompat>;
    await runWithTenantPermissions([tenant], async () => {
      await expect(invoke({}, {} as never)).rejects.toThrow("authorized request write permission");
      expect(connectionState).toBe(1);
      expect(() => assertTenantWriteAccess(tenant)).not.toThrow();
    }, [tenant]);
  } finally { vi.unstubAllEnvs(); }
});

// Independent catalog contract: 28 company reads, 26 company writes, 4 connection tools.
it.each([
  { access: { company: [], connection: [] }, total: 0, reads: 0 },
  { access: { company: ["write"], connection: [] }, total: 26, reads: 0 },
  { access: { company: ["read", "write"], connection: ["read", "write"] }, total: 58, reads: 29 },
  { access: { company: ["read"], connection: [] }, total: 28, reads: 28 },
  { access: { company: ["read", "write"], connection: [] }, total: 54, reads: 28 },
  { access: { company: [], connection: ["read", "write"] }, total: 4, reads: 1 },
  { access: { company: ["read"], connection: ["read", "write"] }, total: 32, reads: 29 },
  { access: { company: ["read", "write"], connection: ["read"] }, total: 55, reads: 29 },
] as { access: ToolContext["access"]; total: number; reads: number }[])("exposes the full permitted resource/access catalog with correct mutation hints for %j", ({ access, total, reads }) => {
  const server = new McpServer({ name: "selection-fixture", version: "1" });
  const registered = vi.spyOn(server, "registerTool");
  ToolFactory(server, { access });
  expect(registered).toHaveBeenCalledTimes(total);
  expect(registered.mock.calls.filter(([, metadata]) => metadata.annotations?.readOnlyHint).length).toBe(reads);
});
