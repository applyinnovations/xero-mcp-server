import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { connectedTenants } from "../clients/xero-client.js";
import { RegisterTool } from "../helpers/register-tool.js";
import { formatError } from "../helpers/format-error.js";

export function ToolFactory(server: McpServer) {

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
  [...GetTools, ...ListTools].forEach(createTool => RegisterTool(server, createTool()));
  // HTTP registers only the narrowly authorized account coding tool separately.
}
