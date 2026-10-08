#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { XeroMcpServer } from "./server/xero-mcp-server.js";
import { ToolFactory } from "./tools/tool-factory.js";
import { createRemoteServer } from "./server/remote-mcp-server.js";
import { loadRemoteConfig } from "./auth/remote-auth.js";
import { configuredTenantIds, configuredWritableTenantIds, configuredTokenProvider } from "./clients/xero-client.js";
import { prepareTokenStore } from "./auth/prepare-token-store.js";
import { z } from "zod";
import { configuredPayrollRegion } from "./payroll/region.js";

const main = async () => {
  configuredPayrollRegion();
  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
  if (transportMode === "http") {
    if (!process.env.XERO_TOKEN_FILE) throw new Error("Remote MCP requires durable OAuth mode");
    const tenants = configuredTenantIds();
    configuredWritableTenantIds();
    configuredTokenProvider();
    const config = loadRemoteConfig();
    if ([...config.subjectTenants.values()].some(ids => ids.some(id => !tenants.includes(id)))) {
      throw new Error("Subject mapping must be a subset of allowed tenant IDs");
    }
    await prepareTokenStore({ statePath: process.env.XERO_TOKEN_FILE,
      keyPath: process.env.XERO_TOKEN_KEY_FILE!, clientId: process.env.XERO_CLIENT_ID!,
      keySourcePath: process.env.XERO_TOKEN_KEY_SOURCE_FILE, allowOnboarding: !!config.connectSubjects?.length });
    const port = z.coerce.number().int().min(1).max(65535).parse(process.env.MCP_PORT ?? "3000");
    const http = createRemoteServer(config);
    http.listen(port, process.env.MCP_HOST ?? "127.0.0.1", () => console.error("Authenticated remote MCP listening"));
    http.on("error", () => { console.error("Remote MCP listener failed"); process.exitCode = 1; });
    return;
  }
  if (transportMode !== "stdio") throw new Error("Unsupported MCP transport");
  // Create an MCP server
  const server = XeroMcpServer.GetServer();

  ToolFactory(server);

  // Start receiving messages on stdin and sending messages on stdout
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
