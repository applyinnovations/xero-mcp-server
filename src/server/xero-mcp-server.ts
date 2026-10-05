import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPackageVersion } from "../helpers/get-package-version.js";

export class XeroMcpServer {
  public static GetServer(): McpServer {
    return new McpServer({ name: "Xero MCP Server", version: getPackageVersion() });
  }
}
