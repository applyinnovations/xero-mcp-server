import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { XeroOnboarding } from "../auth/xero-onboarding.js";
import {
  ZodRawShapeCompat,
  AnySchema,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";

export type ToolAccess = "read" | "write";
export type ToolResource = "company" | "connection";

export interface ToolContext {
  access: Readonly<Record<ToolResource, readonly ToolAccess[]>>;
  subject?: string;
  onboarding?: XeroOnboarding;
}

export type ToolBuilder = (context?: ToolContext) => ToolDefinition<ZodRawShapeCompat>;

export function validateToolResource(resource: unknown): ToolResource {
  if (resource !== "company" && resource !== "connection") throw new Error("Tool resource must be explicitly declared as company or connection");
  return resource;
}

export function validateToolAccess(access: unknown): ToolAccess {
  if (access !== "read" && access !== "write") throw new Error("Tool access must be explicitly declared as read or write");
  return access;
}

export interface ToolDefinition<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> {
  name: string;
  access: ToolAccess;
  resource: ToolResource;
  annotations?: Omit<ToolAnnotations, "readOnlyHint">;
  description: string;
  schema: Args;
  handler: ToolCallback<Args>;
}
