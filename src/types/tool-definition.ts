import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { XeroOnboarding } from "../auth/xero-onboarding.js";
import {
  ZodRawShapeCompat,
  AnySchema,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";

export type ToolAccess = "read" | "write";
export type ToolResource = "company" | "connection";
// Static maintenance status, independent of caller permissions and OAuth consent.
export type ToolSupport = "maintained" | "upstream";

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

export function validateToolSupport(support: unknown): ToolSupport {
  if (support !== "maintained" && support !== "upstream") throw new Error("Tool support must be explicitly declared as maintained or upstream");
  return support;
}

export interface ToolDefinition<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> {
  name: string;
  access: ToolAccess;
  resource: ToolResource;
  support: ToolSupport;
  annotations?: Omit<ToolAnnotations, "readOnlyHint">;
  description: string;
  schema: Args;
  handler: ToolCallback<Args>;
}
