import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition, validateToolAccess } from "../types/tool-definition.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { assertTenantWriteAccess, createTenantClient, runWithReadOnlyAccess, runWithXeroClient } from "../clients/xero-client.js";
import { formatError } from "./format-error.js";

export const CreateXeroTool =
  <Args extends ZodRawShapeCompat>(definition: ToolDefinition<Args>): (() => ToolDefinition<ZodRawShapeCompat>) =>
  () => {
    const access = validateToolAccess(definition.access);
    return {
      ...definition,
      access,
      schema: { ...definition.schema, tenantId: z.string().uuid().describe("Explicit connected Xero organisation ID") },
      handler: async (args, extra) => {
        try {
          const execute = () => {
            const tenantId = z.string().uuid().parse(args.tenantId);
            if (access === "write") assertTenantWriteAccess(tenantId);
            const client = createTenantClient(tenantId);
            const invoke = definition.handler as ToolCallback<ZodRawShapeCompat>;
            return runWithXeroClient(client, () => invoke(args, extra));
          };
          return await (access === "read" ? runWithReadOnlyAccess(execute) : execute());
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: formatError(error) }] };
        }
      },
    };
  };
