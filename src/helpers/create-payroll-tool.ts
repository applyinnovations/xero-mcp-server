import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolBuilder, ToolDefinition } from "../types/tool-definition.js";
import { CreateXeroTool } from "./create-xero-tool.js";
import { assertPayrollOperation, configuredPayrollRegion, nzOnlyPayrollTools, type PayrollRegion } from "../payroll/region.js";

/** Keep shared tenant/auth/access behavior while advertising the configured contract. */
export function CreatePayrollTool<Args extends ZodRawShapeCompat>(
  define: Omit<ToolDefinition<Args>, "resource"> | ((region: PayrollRegion) => Omit<ToolDefinition<Args>, "resource">),
): ToolBuilder {
  return context => {
    const region = configuredPayrollRegion();
    const definition = typeof define === "function" ? define(region) : define;
    const unsupported = region === "AU" && nzOnlyPayrollTools.has(definition.name);
    // Match the shared wrapper's callback boundary when composing middleware.
    const invoke = definition.handler as ToolCallback<ZodRawShapeCompat>;
    return CreateXeroTool<ZodRawShapeCompat>({
      ...definition,
      description: `${unsupported ? "Unsupported in AU. " : ""}Payroll region: ${region}. ${definition.description}`,
      handler: async (args, extra) => {
        // The shared wrapper handles access/context errors; domain rejection is an MCP error.
        try { assertPayrollOperation(region, definition.name); }
        catch (error) { return { isError: true, content: [{ type: "text", text: (error as Error).message }] }; }
        return invoke(args, extra);
      },
    })(context);
  };
}
