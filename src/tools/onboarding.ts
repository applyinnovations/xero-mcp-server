import { z } from "zod";
import { CreateTool } from "../helpers/create-tool.js";
import type { XeroOnboarding } from "../auth/xero-onboarding.js";
import type { ToolContext } from "../types/tool-definition.js";

async function result(context: ToolContext, operation: (onboarding: XeroOnboarding, owner: string) => unknown | Promise<unknown>) {
  try {
    if (!context.onboarding || !context.subject) throw new Error("Connection context unavailable");
    const value = await operation(context.onboarding, context.subject) as Record<string, unknown>;
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
  } catch {
    return { content: [{ type: "text" as const, text: "Xero connection failed or is unavailable. Review configuration, consent status and existing state before retrying." }], isError: true };
  }
}
const transactionId = z.string().min(1).max(128);

export const ConnectionTools = [
  CreateTool(context => ({
    name: "begin-xero-connection", resource: "connection", support: "maintained", access: "write",
    description: "Owner-only Xero PKCE consent. Run only when the user explicitly asks to connect Xero. Return the browser start link to that user. Set renewRevokedGrant only for explicitly requested recovery of an invalid_grant marker with existing configured tenants; healthy stored grants are never replaced. Creates no accounting records.",
    schema: { renewRevokedGrant: z.boolean().optional() }, annotations: { destructiveHint: false, idempotentHint: false },
    handler: input => result(context, (onboarding, owner) => onboarding.begin(owner, input.renewRevokedGrant)),
  })),
  CreateTool(context => ({
    name: "get-xero-connection-status", resource: "connection", support: "maintained", access: "read",
    description: "Owner-only status and organisation names/UUIDs for the current consent transaction. Returns no credentials.",
    schema: { transactionId }, annotations: { destructiveHint: false },
    handler: input => result(context, (onboarding, owner) => onboarding.status(owner, input.transactionId)),
  })),
  CreateTool(context => ({
    name: "continue-xero-connection", resource: "connection", support: "maintained", access: "write",
    description: "Owner-only next sequential organisation consent. Run only after the user asks to connect another intended organisation or retry. Return the new start link; use the same Xero login.",
    schema: { transactionId }, annotations: { destructiveHint: false, idempotentHint: false },
    handler: input => result(context, (onboarding, owner) => onboarding.next(owner, input.transactionId)),
  })),
  CreateTool(context => ({
    name: "confirm-xero-connection", resource: "connection", support: "maintained", access: "write",
    description: "Owner-only encrypted grant persistence. Run only after the user explicitly confirms the complete displayed organisation list. Pass its exact tenant UUIDs. No accounting writes; healthy existing state is never replaced.",
    schema: { transactionId, tenantIds: z.array(z.string().uuid()).min(1), confirmed: z.literal(true) },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: input => result(context, (onboarding, owner) => onboarding.confirm(owner, input.transactionId, input.tenantIds)),
  })),
];
