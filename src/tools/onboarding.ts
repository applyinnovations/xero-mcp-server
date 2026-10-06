import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RegisterTool } from "../helpers/register-tool.js";
import { z } from "zod";
import { XeroOnboarding } from "../auth/xero-onboarding.js";

export function registerOnboardingTools(server: McpServer, onboarding: XeroOnboarding, owner: string) {
  const result = async (operation: () => unknown | Promise<unknown>) => {
    try {
      const value = await operation() as Record<string, unknown>;
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
    } catch {
      return { content: [{ type: "text" as const, text: "Xero connection failed or is unavailable. Review configuration, consent status and existing state before retrying." }], isError: true };
    }
  };
  const transactionId = z.string().min(1).max(128);
  RegisterTool(server, {
    name: "begin-xero-connection", access: "write",
    description: "Owner-only Xero PKCE consent. Run only when the user explicitly asks to connect Xero. Return the browser start link to that user. Set renewRevokedGrant only for explicitly requested recovery of an invalid_grant marker with existing configured tenants; healthy stored grants are never replaced. Creates no accounting records.",
    schema: { renewRevokedGrant: z.boolean().optional() }, annotations: { destructiveHint: false, idempotentHint: false },
    handler: input => result(() => onboarding.begin(owner, input.renewRevokedGrant)),
  });
  RegisterTool(server, {
    name: "get-xero-connection-status", access: "read",
    description: "Owner-only status and organisation names/UUIDs for the current consent transaction. Returns no credentials.",
    schema: { transactionId }, annotations: { destructiveHint: false },
    handler: input => result(() => onboarding.status(owner, input.transactionId)),
  });
  RegisterTool(server, {
    name: "continue-xero-connection", access: "write",
    description: "Owner-only next sequential organisation consent. Run only after the user asks to connect another intended organisation or retry. Return the new start link; use the same Xero login.",
    schema: { transactionId }, annotations: { destructiveHint: false, idempotentHint: false },
    handler: input => result(() => onboarding.next(owner, input.transactionId)),
  });
  RegisterTool(server, {
    name: "confirm-xero-connection", access: "write",
    description: "Owner-only encrypted grant persistence. Run only after the user explicitly confirms the complete displayed organisation list. Pass its exact tenant UUIDs. No accounting writes; healthy existing state is never replaced.",
    schema: { transactionId, tenantIds: z.array(z.string().uuid()).min(1), confirmed: z.literal(true) },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: input => result(() => onboarding.confirm(owner, input.transactionId, input.tenantIds)),
  });
}
