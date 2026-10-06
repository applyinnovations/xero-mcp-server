import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ZodRawShapeCompat,
  AnySchema,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";

export type ToolAccess = "read" | "write";

export function validateToolAccess(access: unknown): ToolAccess {
  if (access !== "read" && access !== "write") throw new Error("Tool access must be explicitly declared as read or write");
  return access;
}

export interface ToolDefinition<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> {
  name: string;
  access: ToolAccess;
  annotations?: Omit<ToolAnnotations, "readOnlyHint">;
  description: string;
  schema: Args;
  handler: ToolCallback<Args>;
}
