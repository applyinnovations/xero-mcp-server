import { realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { configuredTokenProvider, TenantXeroClient } from "../clients/xero-client.js";
import { DurableOAuthProvider } from "./oauth-provider.js";
import { EncryptedTokenStore } from "./token-store.js";
import type { VerifiedAccess } from "./remote-auth.js";

export interface BankCodingConfig {
  tenantId: string; subjects: readonly string[]; clientId: string; scope: string;
  enabled: boolean; grantMode: "shared" | "separate";
}

export function loadBankCodingConfig(mapping: Record<string, string[]>, readScope: string, connectScope?: string): BankCodingConfig | undefined {
  if (z.enum(["true", "false"]).parse(process.env.XERO_RECODING_ENABLED ?? "false") === "false") return undefined;
  const [tenantId] = z.array(z.string().uuid()).length(1).parse((process.env.XERO_RECODING_TENANT_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean));
  const subjects = z.array(z.string().min(1)).nonempty().parse(JSON.parse(process.env.MCP_RECODE_SUBJECTS_JSON ?? "[]"));
  if (subjects.some(subject => !mapping[subject]?.includes(tenantId))) throw new Error("Coding subjects must have read permission for the coding tenant");
  const clientId = z.string().min(1).parse(process.env.MCP_RECODE_CLIENT_ID);
  const scope = z.string().regex(/^[A-Za-z0-9:_-]+$/).parse(process.env.MCP_RECODE_SCOPE ?? "xero:code");
  if (scope === readScope || scope === connectScope) throw new Error("Coding requires a separate action scope");
  const grantMode = z.enum(["shared", "separate"]).parse(process.env.XERO_RECODING_GRANT_MODE);
  return { tenantId, subjects, clientId, scope, enabled: true, grantMode };
}

export function canCodeBankTransactions(config: BankCodingConfig, access: VerifiedAccess, readScope: string): boolean {
  return config.enabled && config.subjects.includes(access.subject) && access.clientId === config.clientId
    && access.tenantIds.includes(config.tenantId) && access.scopes.includes(readScope) && access.scopes.includes(config.scope);
}

export type BankCodingClientFactory = (tenantId: string) => Promise<TenantXeroClient>;

// Grant construction and its tenant/scope boundary belong to authentication,
// independently of the account coding handler and agent's approval workflow.
export function createBankCodingClientFactory(config: BankCodingConfig): BankCodingClientFactory {
  const path = process.env.XERO_RECODING_TOKEN_FILE, key = process.env.XERO_RECODING_TOKEN_KEY_FILE, clientId = process.env.XERO_RECODING_CLIENT_ID;
  const readPath = process.env.XERO_TOKEN_FILE;
  const provider = config.grantMode === "shared" ? configuredTokenProvider() : (() => {
    if (!path || !key || !clientId || !readPath || clientId === process.env.XERO_CLIENT_ID) throw new Error("Separate coding grant requires a distinct approved OAuth app and complete state paths");
    return new DurableOAuthProvider({ store: new EncryptedTokenStore(path, key, clientId), clientId });
  })();
  return async tenantId => {
    if (!config.enabled || tenantId !== config.tenantId) throw new Error("Selected tenant is not allowed for account coding");
    if (config.grantMode === "separate") {
      const [readFile, writeFile] = await Promise.all([realpath(readPath!), realpath(path!)]);
      const [readStat, writeStat] = await Promise.all([stat(readFile), stat(writeFile)]);
      if (readFile === writeFile || (readStat.dev === writeStat.dev && readStat.ino === writeStat.ino)) throw new Error("Separate coding state must not alias the read grant");
    }
    const tokens = await provider.getTokenSet();
    if (!(tokens.scope ?? "").split(" ").includes("accounting.banktransactions")) throw new Error("Coding grant lacks accounting.banktransactions consent");
    const client = new TenantXeroClient(tenantId, { getTokenSet: async () => tokens });
    await client.authenticate();
    if (config.grantMode === "separate" && (client.tenants.length !== 1 || client.tenants[0].tenantId !== tenantId)) throw new Error("Separate coding grant must connect only the coding tenant");
    return client;
  };
}
