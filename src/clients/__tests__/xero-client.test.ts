import { afterEach, describe, expect, it, vi } from "vitest";
import { XeroClient } from "xero-node";
import { createTenantClient, runWithXeroClient, TenantXeroClient, xeroClient } from "../xero-client.js";

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const provider = { getTokenSet: async () => ({ access_token: "invalid-fixture-token" }) };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("tenant context", () => {
  it("isolates simultaneous operations and rejects operations without a context", async () => {
    const read = (id: string) => runWithXeroClient(new TenantXeroClient(id, provider), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return xeroClient.tenantId;
    });
    expect(await Promise.all([read(tenantA), read(tenantB)])).toEqual([tenantA, tenantB]);
    expect(() => xeroClient.tenantId).toThrow("explicit tenant context");
  });

  it("does not substitute the first connected tenant for an unconnected selection", async () => {
    vi.spyOn(XeroClient.prototype, "updateTenants").mockImplementation(async function () {
      Object.defineProperty(this, "tenants", { value: [{ tenantId: tenantA }] });
      return this.tenants;
    });
    await expect(new TenantXeroClient(tenantB, provider).authenticate()).rejects.toThrow("not connected");
    const selected = new TenantXeroClient(tenantA, provider);
    await selected.authenticate();
    expect(selected.tenantId).toBe(tenantA);
  });

  it("requires an explicit allowlist before creating any client", () => {
    vi.stubEnv("XERO_ALLOWED_TENANT_IDS", "");
    expect(() => createTenantClient(tenantA)).toThrow("explicitly allow");
    vi.stubEnv("XERO_ALLOWED_TENANT_IDS", tenantA);
    expect(() => createTenantClient(tenantB)).toThrow("not allowed");
  });
});
