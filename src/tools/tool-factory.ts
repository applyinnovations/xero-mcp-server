import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { connectedTenants } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";

export function ToolFactory(server: McpServer) {

  server.tool("list-tenants", "List connected organisations allowed by this server. Select a tenantId explicitly for all accounting reads.", {}, async () => {
    try {
      const result = { tenants: await connectedTenants() };
      return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: formatError(error) }] };
    }
  });
  GetTools.map((tool) => tool()).forEach((tool) =>
    server.tool(tool.name, tool.description, tool.schema, tool.handler),
  );
  ListTools.map((tool) => tool()).forEach((tool) =>
    server.tool(tool.name, tool.description, tool.schema, tool.handler),
  );
  // HTTP registers only the narrowly authorized account coding tool separately.
}
