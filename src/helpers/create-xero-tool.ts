import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { createTenantClient, runWithXeroClient } from "../clients/xero-client.js";
import { formatError } from "./format-error.js";

export const CreateXeroTool =
  <Args extends ZodRawShapeCompat>(
    name: string,
    description: string,
    schema: Args,
    handler: ToolCallback<Args>,
  ): (() => ToolDefinition<ZodRawShapeCompat>) =>
  () => ({
    name: name,
    description: description,
    schema: { ...schema, tenantId: z.string().uuid().describe("Explicit connected Xero organisation ID") },
    handler: async (args, extra) => {
      try {
        const tenantId = z.string().uuid().parse(args.tenantId);
        const client = createTenantClient(tenantId);
        const invoke = handler as ToolCallback<ZodRawShapeCompat>;
        return await runWithXeroClient(client, () => invoke(args, extra));
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: formatError(error) }] };
      }
    },
  });
