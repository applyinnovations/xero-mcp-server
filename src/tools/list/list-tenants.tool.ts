import { connectedTenants } from "../../clients/xero-client.js";
import { CreateTool } from "../../helpers/create-tool.js";
import { formatError } from "../../helpers/format-error.js";

export default CreateTool(() => ({
  name: "list-tenants",
  description: "List connected organisations allowed by this server. Select a tenantId explicitly for all accounting reads.",
  resource: "company", access: "read", schema: {},
  handler: async () => {
    try {
      const result = { tenants: await connectedTenants() };
      return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: formatError(error) }] };
    }
  },
}));
