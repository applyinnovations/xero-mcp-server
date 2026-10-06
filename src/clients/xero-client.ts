import axios, { AxiosError } from "axios";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "node:async_hooks";
import { Organisation, TokenSet, TokenSetParameters, XeroClient } from "xero-node";
import { z } from "zod";
import { DurableOAuthProvider } from "../auth/oauth-provider.js";
import { EncryptedTokenStore } from "../auth/token-store.js";

dotenv.config();

export interface XeroTokenProvider {
  getTokenSet(): Promise<TokenSetParameters>;
}

interface SdkRequest { method?: string; headers?: Record<string, unknown> }

export class TenantXeroClient extends XeroClient {
  private tokens?: Promise<TokenSetParameters>;
  private authentication?: Promise<void>;
  private shortCode?: string;

  constructor(public readonly tenantId: string, private readonly provider: XeroTokenProvider) {
    super();
    z.string().uuid().parse(tenantId);
    // The locked SDK calls default authentication after merging caller headers and
    // applying OAuth. Guard the actual request, including indirect SDK routes.
    for (const api of [this.accountingApi, this.assetApi, this.filesApi, this.projectApi,
      this.payrollAUApi, this.bankFeedsApi, this.payrollUKApi, this.payrollNZApi,
      this.appStoreApi, this.financeApi]) {
      const authentication = (api as unknown as { authentications: { default: { applyToRequest(request: SdkRequest): void | Promise<void> } } }).authentications.default;
      const apply = authentication.applyToRequest.bind(authentication);
      authentication.applyToRequest = async request => {
        await apply(request);
        const headers = Object.entries(request.headers ?? {}).filter(([name]) => name.toLowerCase() === "xero-tenant-id");
        if (headers.length !== 1 || headers[0][1] !== this.tenantId) throw new Error("Xero request tenant must match the selected tenant");
        if (!effectiveTenantIds().includes(this.tenantId)) throw new Error("Selected tenant is not allowed");
        if (!["GET", "HEAD", "OPTIONS"].includes((request.method ?? "").toUpperCase())) assertTenantWriteAccess(this.tenantId);
      };
    }
  }

  async authenticate(requiredScopes: readonly string[] = []): Promise<void> {
    const tokens = await (this.tokens ??= this.provider.getTokenSet());
    const scopes = (tokens.scope ?? "").split(" ");
    if (requiredScopes.some(scope => !scopes.includes(scope))) throw new Error("Xero grant lacks required OAuth consent");
    this.authentication ??= this.authenticateTenant(tokens);
    return this.authentication;
  }

  private async authenticateTenant(tokens: TokenSetParameters): Promise<void> {
    this.setTokenSet(tokens);
    await this.updateTenants(false);
    if (!this.tenants.some((tenant: { tenantId: string }) => tenant.tenantId === this.tenantId)) {
      throw new Error("Selected tenant is not connected to this Xero grant");
    }
  }

  async getShortCode(): Promise<string | undefined> {
    await this.authenticate();
    if (!this.shortCode) {
      const response = await this.accountingApi.getOrganisations(this.tenantId);
      const organisation: Organisation | undefined = response.body.organisations?.[0];
      this.shortCode = organisation?.shortCode;
    }
    return this.shortCode;
  }
}

const context = new AsyncLocalStorage<TenantXeroClient>();
const permissions = new AsyncLocalStorage<{ read: readonly string[]; write: readonly string[] }>();

export function runWithTenantPermissions<T>(tenantIds: readonly string[], callback: () => T, writeTenantIds: readonly string[] = []): T {
  return permissions.run({ read: tenantIds, write: writeTenantIds }, callback);
}

// Read tools cannot inherit a caller's mutation authority, including indirect SDK calls.
export function runWithReadOnlyAccess<T>(callback: () => T): T {
  const requested = permissions.getStore();
  return requested ? permissions.run({ read: requested.read, write: [] }, callback) : callback();
}

// Omitted companies are read-only. This policy governs every SDK mutation,
// independently of which tools are registered or what the OAuth grant permits.
export function configuredWritableTenantIds(): string[] {
  const allowed = configuredTenantIds();
  const policy = z.record(z.string().uuid(), z.enum(["read-only", "read-write"]))
    .parse(JSON.parse(process.env.XERO_TENANT_ACCESS_JSON ?? "{}"));
  if (Object.keys(policy).some(id => !allowed.includes(id))) throw new Error("Company access policy must be a subset of allowed tenant IDs");
  return allowed.filter(id => policy[id] === "read-write");
}

export function assertTenantWriteAccess(tenantId: string): void {
  if (!effectiveTenantIds().includes(tenantId) || !configuredWritableTenantIds().includes(tenantId)) throw new Error("Selected company is read-only");
  if (!permissions.getStore()?.write.includes(tenantId)) throw new Error("Xero mutation requires authorized request write permission");
}

function effectiveTenantIds(): string[] {
  const allowed = configuredTenantIds();
  const requested = permissions.getStore();
  return requested ? allowed.filter((tenantId) => requested.read.includes(tenantId)) : allowed;
}

export function runWithXeroClient<T>(client: TenantXeroClient, callback: () => T): T {
  return context.run(client, callback);
}

// Existing handlers resolve the client belonging to this invocation, never a global tenant.
export const xeroClient = new Proxy({} as TenantXeroClient, {
  get(_target, property) {
    const client = context.getStore();
    if (!client) throw new Error("Xero operation requires an explicit tenant context");
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export function configuredTenantIds(): string[] {
  const ids = (process.env.XERO_ALLOWED_TENANT_IDS ?? "").split(",").filter(Boolean);
  if (!ids.length && process.env.MCP_TRANSPORT === "http" && process.env.XERO_ONBOARDING_ENABLED === "true") return [];
  if (!ids.length) throw new Error("XERO_ALLOWED_TENANT_IDS must explicitly allow connected tenants");
  return ids.map((id) => z.string().uuid().parse(id.trim()));
}

export function createTenantClient(tenantId: string): TenantXeroClient {
  if (!effectiveTenantIds().includes(tenantId)) throw new Error("Selected tenant is not allowed");
  return new TenantXeroClient(tenantId, configuredTokenProvider());
}

export function configuredTokenProvider(): XeroTokenProvider {
  const tokenFile = process.env.XERO_TOKEN_FILE;
  if (tokenFile) {
    const keyFile = process.env.XERO_TOKEN_KEY_FILE;
    const clientId = process.env.XERO_CLIENT_ID;
    if (!keyFile || !clientId || process.env.XERO_CLIENT_BEARER_TOKEN) throw new Error("Durable OAuth configuration is incomplete or conflicts with a static token");
    return new DurableOAuthProvider({ store: new EncryptedTokenStore(tokenFile, keyFile, clientId), clientId, clientSecret: process.env.XERO_CLIENT_SECRET });
  }
  const token = process.env.XERO_CLIENT_BEARER_TOKEN;
  if (token) return { getTokenSet: async () => ({ access_token: token }) };
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Xero authentication is not configured");
  const client = new CustomConnectionsXeroClient({ clientId, clientSecret, grantType: "client_credentials" });
  return { getTokenSet: () => client.getClientCredentialsToken() };
}

export async function connectedTenants(): Promise<{ tenantId: string; tenantName: string; tenantType: string }[]> {
  const allowed = effectiveTenantIds();
  const client = new XeroClient();
  client.setTokenSet(await configuredTokenProvider().getTokenSet());
  await client.updateTenants(false);
  return client.tenants
    .filter((tenant: { tenantId: string }) => allowed.includes(tenant.tenantId))
    .map((tenant: { tenantId: string; tenantName: string; tenantType: string }) => ({
      tenantId: tenant.tenantId, tenantName: tenant.tenantName, tenantType: tenant.tenantType,
    }));
}

class CustomConnectionsXeroClient extends XeroClient {
  private readonly clientId: string;
  private readonly clientSecret: string;

  // Legacy scopes (deprecated but still supported for existing apps)
  private readonly XERO_DEFAULT_AUTH_SCOPES_V1 = [
    "accounting.transactions",
    "accounting.contacts",
    "accounting.settings",
    "accounting.reports.read",
    "payroll.settings",
    "payroll.employees",
    "payroll.timesheets",
  ].join(" ");

  // Granular scopes (required for new apps)
  private readonly XERO_DEFAULT_AUTH_SCOPES_V2 = [
    "accounting.invoices",
    "accounting.payments",
    "accounting.banktransactions",
    "accounting.manualjournals",
    "accounting.reports.aged.read",
    "accounting.reports.balancesheet.read",
    "accounting.reports.profitandloss.read",
    "accounting.reports.trialbalance.read",
    "accounting.contacts",
    "accounting.settings",
    "payroll.settings",
    "payroll.employees",
    "payroll.timesheets",
  ].join(" ");

  constructor(config: {
    clientId: string;
    clientSecret: string;
    grantType: string;
  }) {
    super(config);
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  private formatTokenError(error: unknown, context: string): Error {
    const axiosError = error as AxiosError;
    const data = axiosError.response?.data;
    const message =
      typeof data === "object" ? JSON.stringify(data) : data || axiosError.message;
    return new Error(`Failed to get Xero token${context}: ${message}`);
  }

  public async getClientCredentialsToken(): Promise<TokenSet> {
    // If XERO_SCOPES is set, use that
    if (process.env.XERO_SCOPES) {                                                                                                                                                     
      try {
        return await this.requestToken(process.env.XERO_SCOPES);
      } catch (envError) {
        throw this.formatTokenError(envError, " with XERO_SCOPES");
      }
    }

    // Else if XERO_SCOPES is not set, try V1 scopes first (for existing apps), fallback to V2 scopes (for new apps) only on invalid_scope error
    try {
      return await this.requestToken(this.XERO_DEFAULT_AUTH_SCOPES_V1);
    } catch (error) {
      const axiosError = error as AxiosError;
      const isInvalidScope =
        axiosError.response?.status === 400 &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (axiosError.response?.data as any)?.error === "invalid_scope";

      if (!isInvalidScope) {
        throw this.formatTokenError(error, " with V1 scopes");
      }

      try {
        return await this.requestToken(this.XERO_DEFAULT_AUTH_SCOPES_V2);
      } catch (v2Error) {
        throw this.formatTokenError(v2Error, " with V2 scopes");
      }
    }
  }

  private async requestToken(scope: string): Promise<TokenSet> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    const response = await axios.post(
      "https://identity.xero.com/connect/token",
      `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      },
    );

    return response.data;
  }

}
