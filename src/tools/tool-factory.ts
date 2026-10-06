import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { connectedTenants } from "../clients/xero-client.js";
import { RegisterTool } from "../helpers/register-tool.js";
import { formatError } from "../helpers/format-error.js";
import CodeBankTransactionTool from "./update/code-bank-transaction.tool.js";
import type { ToolAccess } from "../types/tool-definition.js";

export function ToolFactory(server: McpServer, access: readonly ToolAccess[] = ["read"]) {

  RegisterTool(server, {
    name: "list-tenants",
    description: "List connected organisations allowed by this server. Select a tenantId explicitly for all accounting reads.",
    access: "read",
    schema: {},
    handler: async () => {
      try {
        const result = { tenants: await connectedTenants() };
        return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: formatError(error) }] };
      }
    },
  });
  for (const createTool of [...GetTools, ...ListTools, CodeBankTransactionTool]) {
    const tool = createTool();
    if (access.includes(tool.access)) RegisterTool(server, tool);
  }
}
