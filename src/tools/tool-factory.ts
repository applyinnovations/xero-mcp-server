import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RegisterTool } from "../helpers/register-tool.js";
import type { ToolContext } from "../types/tool-definition.js";
import { ToolCatalog } from "./index.js";

export function ToolFactory(server: McpServer, context: ToolContext = { access: { company: ["read"], connection: [] } }) {
  for (const createTool of ToolCatalog) {
    const tool = createTool(context);
    if (context.access[tool.resource].includes(tool.access)) RegisterTool(server, tool);
  }
}
