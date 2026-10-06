import { expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { CreateXeroTool } from "../create-xero-tool.js";
import { RegisterTool } from "../register-tool.js";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { ToolFactory } from "../../tools/tool-factory.js";
import { GetTools } from "../../tools/get/index.js";
import { ListTools } from "../../tools/list/index.js";
import { CreateTools } from "../../tools/create/index.js";
import { UpdateTools } from "../../tools/update/index.js";
import { DeleteTools } from "../../tools/delete/index.js";
import { registerBankCodingTool } from "../../tools/update/code-bank-transaction.tool.js";
import { registerOnboardingTools } from "../../tools/onboarding.js";
import type { XeroOnboarding } from "../../auth/xero-onboarding.js";

it("rejects missing or invalid access metadata before creating or registering a tool", () => {
  const server = new McpServer({ name: "classification-fixture", version: "1" });
  const registered = vi.spyOn(server, "registerTool");
  for (const access of [undefined, "", "admin"]) {
    const tool = { name: "unclassified", description: "Fixture", schema: {}, access, handler: async () => ({ content: [] }) } as unknown as ToolDefinition<ZodRawShapeCompat>;
    expect(() => CreateXeroTool(tool)()).toThrow("explicitly declared");
    expect(() => RegisterTool(server, tool)).toThrow("explicitly declared");
  }
  expect(registered).not.toHaveBeenCalled();
});

it("derives MCP hints from explicit access, independently of the tool's name", () => {
  const server = new McpServer({ name: "hint-fixture", version: "1" });
  const registered = vi.spyOn(server, "registerTool");
  RegisterTool(server, { name: "create-read-fixture", description: "Fixture", access: "read", schema: {}, handler: async () => ({ content: [] }) });
  RegisterTool(server, { name: "get-write-fixture", description: "Fixture", access: "write", schema: {}, annotations: { destructiveHint: false }, handler: async () => ({ content: [] }) });
  expect(registered.mock.calls.map(([, metadata]) => metadata.annotations)).toEqual([
    { readOnlyHint: true }, { readOnlyHint: false, destructiveHint: false },
  ]);
});

it("covers every existing company tool and all registered connection tools with explicit access", () => {
  for (const factory of [...GetTools, ...ListTools]) expect(factory().access).toBe("read");
  for (const factory of [...CreateTools, ...UpdateTools, ...DeleteTools]) expect(factory().access).toBe("write");
  const server = new McpServer({ name: "registry-fixture", version: "1" });
  const registered = vi.spyOn(server, "registerTool");
  ToolFactory(server);
  registerBankCodingTool(server, async () => { throw new Error("Fixture writer must not execute"); }, "synthetic-owner");
  registerOnboardingTools(server, {} as XeroOnboarding, "synthetic-owner");
  const classifications = new Map(registered.mock.calls.map(([name, metadata]) => [name, metadata.annotations?.readOnlyHint]));
  expect(classifications.size).toBe(GetTools.length + ListTools.length + 6);
  expect([...classifications.values()].every(value => typeof value === "boolean")).toBe(true);
  expect(classifications.get("list-tenants")).toBe(true);
  expect(classifications.get("code-bank-transaction")).toBe(false);
  expect(classifications.get("begin-xero-connection")).toBe(false);
  expect(classifications.get("get-xero-connection-status")).toBe(true);
  expect(classifications.get("continue-xero-connection")).toBe(false);
  expect(classifications.get("confirm-xero-connection")).toBe(false);
});
