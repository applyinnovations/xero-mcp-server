import { isAbsolute } from "node:path";
import { z } from "zod";

export interface RecodeConfig {
  tenantId: string; subjects: readonly string[]; clientId: string; scope: string;
  enabled: boolean; auditDirectory?: string; grantMode?: "shared" | "separate";
}
export function loadRecodeConfig(mapping: Record<string, string[]>, readScope: string, connectScope?: string): RecodeConfig | undefined {
  const enabled = z.enum(["true", "false"]).parse(process.env.XERO_RECODING_ENABLED ?? "false") === "true";
  const ids = (process.env.XERO_RECODING_TENANT_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
  if (!ids.length && !enabled) return undefined;
  const [tenantId] = z.array(z.string().uuid()).length(1).parse(ids);
  const subjects = z.array(z.string().min(1)).nonempty().parse(JSON.parse(process.env.MCP_RECODE_SUBJECTS_JSON ?? "[]"));
  if (subjects.some(subject => !mapping[subject]?.includes(tenantId))) throw new Error("Coding subjects must have read permission for the coding tenant");
  const clientId = z.string().min(1).parse(process.env.MCP_RECODE_CLIENT_ID);
  const scope = z.string().regex(/^[A-Za-z0-9:_-]+$/).parse(process.env.MCP_RECODE_SCOPE ?? "xero:code");
  if (scope === readScope || scope === connectScope) throw new Error("Coding requires a separate action scope");
  const grantMode = process.env.XERO_RECODING_GRANT_MODE ? z.enum(["shared", "separate"]).parse(process.env.XERO_RECODING_GRANT_MODE) : undefined;
  const auditDirectory = process.env.XERO_RECODING_AUDIT_DIR;
  if (enabled && (process.env.XERO_RECODING_LINKAGE_VALIDATED !== "true" || !grantMode || !auditDirectory || !isAbsolute(auditDirectory))) {
    throw new Error("Coding activation requires Demo linkage validation, an explicit grant mode and an absolute private audit directory");
  }
  return { tenantId, subjects, clientId, scope, enabled, auditDirectory, grantMode };
}
