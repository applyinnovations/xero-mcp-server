import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTenantClient } from "../clients/xero-client.js";
import { RegisterTool } from "../helpers/register-tool.js";
import { selectPayrollModule, type PayrollModule } from "../payroll/module.js";
import type { ToolContext } from "../types/tool-definition.js";
import { ToolCatalog } from "./index.js";

export function ToolFactory(
  server: McpServer,
  context: ToolContext = { access: { company: ["read"], connection: [] } },
  payroll: PayrollModule = selectPayrollModule(),
) {
  const boundContext: ToolContext = {
    ...context,
    tenantClientFactory:
      context.tenantClientFactory ??
      ((tenantId) => createTenantClient(tenantId, payroll.region)),
  };
  for (const createTool of ToolCatalog(payroll)) {
    const tool = createTool(boundContext);
    if (context.access[tool.resource].includes(tool.access))
      RegisterTool(server, tool);
  }
}
