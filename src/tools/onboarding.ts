import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  server.registerTool("begin-xero-connection", {
    description: "Owner-only Xero PKCE consent. Run only when the user explicitly asks to connect Xero. Return the browser start link to that user. Set renewRevokedGrant only for explicitly requested recovery of an invalid_grant marker with existing configured tenants; healthy stored grants are never replaced. Creates no accounting records.",
    inputSchema: { renewRevokedGrant: z.boolean().optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, input => result(() => onboarding.begin(owner, input.renewRevokedGrant)));
  server.registerTool("get-xero-connection-status", {
    description: "Owner-only status and organisation names/UUIDs for the current consent transaction. Returns no credentials.",
    inputSchema: { transactionId }, annotations: { readOnlyHint: true, destructiveHint: false },
  }, input => result(() => onboarding.status(owner, input.transactionId)));
  server.registerTool("continue-xero-connection", {
    description: "Owner-only next sequential organisation consent. Run only after the user asks to connect another intended organisation or retry. Return the new start link; use the same Xero login.",
    inputSchema: { transactionId }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, input => result(() => onboarding.next(owner, input.transactionId)));
  server.registerTool("confirm-xero-connection", {
    description: "Owner-only encrypted grant persistence. Run only after the user explicitly confirms the complete displayed organisation list. Pass its exact tenant UUIDs. No accounting writes; healthy existing state is never replaced.",
    inputSchema: { transactionId, tenantIds: z.array(z.string().uuid()).min(1).max(5), confirmed: z.literal(true) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, input => result(() => onboarding.confirm(owner, input.transactionId, input.tenantIds)));
}
