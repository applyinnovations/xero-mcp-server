import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { JWTVerifyGetKey } from "jose";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RemoteAuthError, RemoteConfig, createAccessVerifier } from "../auth/remote-auth.js";
import { runWithTenantPermissions } from "../clients/xero-client.js";
import { XeroMcpServer } from "./xero-mcp-server.js";
import { ToolFactory } from "../tools/tool-factory.js";

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1048576) throw new Error("Request body exceeds limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createRemoteServer(config: RemoteConfig, key?: JWTVerifyGetKey) {
  const verify = createAccessVerifier(config, key);
  const resource = new URL(config.resource);
  const metadataPath = `/.well-known/oauth-protected-resource${resource.pathname}`;
  const metadataUrl = new URL(metadataPath, resource.origin).href;
  const hosts = new Set([resource.hostname, "127.0.0.1", "localhost"]);
  const challenge = `Bearer resource_metadata="${metadataUrl}", scope="${config.readScope}"`;
  const server = createServer((request, response) => {
    void (async () => {
      try {
        let host;
        try { host = new URL(`http://${request.headers.host ?? ""}`); }
        catch { json(response, 403, { error: "Host not allowed" }); return; }
        if (host.username || host.password || host.search || host.hash || host.pathname !== "/" || !hosts.has(host.hostname)) {
          json(response, 403, { error: "Host not allowed" }); return;
        }
        const origin = request.headers.origin;
        if (origin && !config.allowedOrigins.includes(origin)) {
          json(response, 403, { error: "Origin not allowed" }); return;
        }
        if (origin) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Vary", "Origin");
          response.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
        }
        if (request.method === "GET" && [metadataPath, "/.well-known/oauth-protected-resource"].includes(request.url ?? "")) {
          json(response, 200, { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: [config.readScope], bearer_methods_supported: ["header"] }); return;
        }
        // Match the internal endpoint exactly. Public path prefixes belong to the reverse proxy.
        if (request.url !== "/mcp") { json(response, 404, { error: "Not found" }); return; }
        if (request.method === "OPTIONS" && origin) {
          response.writeHead(204, { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version" });
          response.end(); return;
        }
        const authorization = request.headers.authorization;
        const token = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
        if (!token || token.length > 16384) throw new RemoteAuthError(401);
        const permissions = await verify(token);
        if (request.method !== "POST") { response.setHeader("Allow", "POST, OPTIONS"); json(response, 405, { error: "Stateless MCP accepts POST only" }); return; }
        if (!request.headers["content-type"]?.startsWith("application/json")) { json(response, 415, { error: "JSON body required" }); return; }
        let body;
        try { body = await requestBody(request); }
        catch { json(response, 400, { error: "Invalid or oversized JSON body" }); return; }
        await runWithTenantPermissions(permissions, async () => {
          const mcp = XeroMcpServer.GetServer();
          ToolFactory(mcp);
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
          let closed = false;
          const close = () => { if (!closed) { closed = true; void mcp.close().catch(() => {}); } };
          response.once("finish", close);
          response.once("close", close);
          await mcp.connect(transport);
          await transport.handleRequest(request, response, body);
        });
      } catch (error) {
        if (response.headersSent) { response.destroy(); return; }
        if (error instanceof RemoteAuthError) {
          response.setHeader("WWW-Authenticate", error.status === 403 ? `${challenge}, error="insufficient_scope"` : challenge);
          json(response, error.status, { error: error.status === 401 ? "Unauthorized" : "Forbidden" });
        } else { json(response, 500, { error: "Remote MCP request failed" }); }
      }
    })();
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
