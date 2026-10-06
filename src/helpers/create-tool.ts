import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { ToolBuilder, ToolContext, ToolDefinition, validateToolAccess, validateToolResource, validateToolSupport } from "../types/tool-definition.js";

export function CreateTool<Args extends ZodRawShapeCompat>(define: (context: ToolContext) => ToolDefinition<Args>): ToolBuilder {
  return (context = { access: { company: [], connection: [] } }) => {
    const tool = define(context);
    validateToolAccess(tool.access);
    validateToolResource(tool.resource);
    validateToolSupport(tool.support);
    return { ...tool, handler: tool.handler as ToolCallback<ZodRawShapeCompat> };
  };
}
