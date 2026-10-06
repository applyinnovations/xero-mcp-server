import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { ToolDefinition, validateToolAccess, validateToolResource } from "../types/tool-definition.js";
import { runWithReadOnlyAccess } from "../clients/xero-client.js";

export function RegisterTool<Args extends ZodRawShapeCompat>(server: McpServer, tool: ToolDefinition<Args>) {
  const access = validateToolAccess(tool.access);
  validateToolResource(tool.resource);
  const invoke = tool.handler as ToolCallback<ZodRawShapeCompat>;
  return server.registerTool<ZodRawShapeCompat, ZodRawShapeCompat>(tool.name, {
    description: tool.description, inputSchema: tool.schema,
    annotations: { ...tool.annotations, readOnlyHint: access === "read" },
  }, (args, extra) => {
    const execute = () => invoke(args, extra);
    return access === "read" || tool.resource === "connection" ? runWithReadOnlyAccess(execute) : execute();
  });
}
