import { z } from "zod";
import type { XeroTokenProvider } from "../clients/xero-client.js";
import { EncryptedTokenStore, StoredTokens } from "./token-store.js";

const refreshSchema = z.object({
  access_token: z.string().min(1).max(16384), refresh_token: z.string().min(1).max(16384),
  expires_in: z.number().int().min(61).max(86400), token_type: z.literal("Bearer"), scope: z.string().optional(),
});
interface OAuthProviderOptions {
  store: EncryptedTokenStore;
  clientId: string;
  clientSecret?: string;
  request?: typeof fetch;
  now?: () => number;
}

export class DurableOAuthProvider implements XeroTokenProvider {
  constructor(private readonly options: OAuthProviderOptions) {}

  async getTokenSet() {
    // Each provider/process rereads state under the same lock. A rotating refresh
    // token belongs to the grant, shared by its connected organisations.
    try {
      return await this.options.store.withLock(async () => {
        const tokens = await this.options.store.read();
        if (tokens.reauthorizeRequired) throw new Error("Xero authorization needs renewal");
        const now = Math.floor((this.options.now?.() ?? Date.now()) / 1000);
        let current = tokens;
        if (tokens.expires_at <= now + 60) {
          current = await this.refresh(tokens, now);
          await this.options.store.write(current);
        }
        // Accounting clients need only the access token, not refresh credentials.
        return { access_token: current.access_token, expires_at: current.expires_at, token_type: "Bearer", scope: current.scope };
      });
    } catch {
      // Never expose response bodies, tokens, encryption errors or configured paths.
      throw new Error("Xero OAuth credentials unavailable; inspect state or renew authorization");
    }
  }

  private async refresh(tokens: StoredTokens, now: number): Promise<StoredTokens> {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: this.options.clientId });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    if (this.options.clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64")}`;
    }
    const response = await (this.options.request ?? fetch)("https://identity.xero.com/connect/token", {
      method: "POST", headers, body, signal: AbortSignal.timeout(10000), redirect: "error",
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: string };
      if (error.error === "invalid_grant") await this.options.store.write({ ...tokens, reauthorizeRequired: true });
      throw new Error("Xero token refresh failed");
    }
    const refreshed = refreshSchema.parse(await response.json());
    return { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, expires_at: now + refreshed.expires_in, scope: refreshed.scope ?? tokens.scope };
  }
}
