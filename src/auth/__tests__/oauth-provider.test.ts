import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DurableOAuthProvider } from "../oauth-provider.js";
import { EncryptedTokenStore, StoredTokens } from "../token-store.js";

let directory: string;
let path: string;
let keyPath: string;
let store: EncryptedTokenStore;
let initialRevision: string | undefined;
const tokens: StoredTokens = { access_token: "invalid-old-access", refresh_token: "invalid-old-refresh", expires_at: 1000, scope: "offline_access accounting.banktransactions.read" };
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "xero-oauth-fixture-"));
  path = join(directory, "tokens.json"); keyPath = join(directory, "key");
  await writeFile(keyPath, Buffer.alloc(32, 7).toString("base64"), { mode: 0o600 });
  store = new EncryptedTokenStore(path, keyPath, "fixture-client");
  await store.initialize(tokens);
  initialRevision = (await store.read()).grantRevision;
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
const success = () => new Response(JSON.stringify({ access_token: "invalid-new-access", refresh_token: "invalid-new-refresh", expires_in: 1800, token_type: "Bearer" }), { status: 200 });
const options = (request: typeof fetch, selectedStore = store) => ({ store: selectedStore, clientId: "fixture-client", request, now: () => 1000000 });

describe("durable OAuth", () => {
  it("encrypts private state and recovers it through a new store instance", async () => {
    const disk = await readFile(path, "utf8");
    expect(disk).not.toContain(tokens.access_token);
    expect(disk).not.toContain(tokens.refresh_token);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await new EncryptedTokenStore(path, keyPath, "fixture-client").read()).toEqual({ ...tokens, grantRevision: initialRevision });
    await expect(store.initialize(tokens)).rejects.toThrow("already exists");
  });

  it("serializes different providers on one grant and persists the rotated token", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      expect(String(init?.body)).toContain("refresh_token=invalid-old-refresh");
      expect(init?.redirect).toBe("error");
      await new Promise((resolve) => setTimeout(resolve, 15));
      return success();
    });
    const providers = Array.from({ length: 5 }, () => new DurableOAuthProvider(options(request, new EncryptedTokenStore(path, keyPath, "fixture-client"))));
    const results = await Promise.all(providers.map((provider) => provider.getTokenSet()));
    expect(request).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.access_token === "invalid-new-access")).toBe(true);
    expect(results.every((result) => !("refresh_token" in result))).toBe(true);
    expect(results.every((result) => result.scope === tokens.scope)).toBe(true);
    expect((await store.read()).refresh_token).toBe("invalid-new-refresh");
    expect((await store.read()).grantRevision).toBe(initialRevision);
    const restarted = new DurableOAuthProvider(options(request, new EncryptedTokenStore(path, keyPath, "fixture-client")));
    await restarted.getTokenSet();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never returns refreshed credentials if persistence fails", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(success());
    vi.spyOn(store, "write").mockRejectedValue(new Error("fixture disk failure"));
    await expect(new DurableOAuthProvider(options(request)).getTokenSet()).rejects.toThrow("credentials unavailable");
    expect((await store.read()).refresh_token).toBe(tokens.refresh_token);
  });

  it("retains old state on transient failure and redacts response payloads", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ error: "server_error", access_token: "SENSITIVE_RESPONSE" }), { status: 500 })).mockResolvedValueOnce(success());
    const provider = new DurableOAuthProvider(options(request));
    await expect(provider.getTokenSet()).rejects.toThrow("credentials unavailable");
    expect(await store.read()).toEqual({ ...tokens, grantRevision: initialRevision });
    expect((await provider.getTokenSet()).access_token).toBe("invalid-new-access");
  });

  it("records invalid_grant and stops refresh retries until authorization is renewed", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const provider = new DurableOAuthProvider(options(request));
    await expect(provider.getTokenSet()).rejects.toThrow("credentials unavailable");
    await expect(provider.getTokenSet()).rejects.toThrow("credentials unavailable");
    expect(request).toHaveBeenCalledTimes(1);
    expect((await store.read()).reauthorizeRequired).toBe(true);
    expect((await store.read()).grantRevision).toBe(initialRevision);
  });

  it("rejects tampered ciphertext, client substitution and public key files", async () => {
    await expect(new EncryptedTokenStore(path, keyPath, "different-client").read()).rejects.toThrow();
    const envelope = JSON.parse(await readFile(path, "utf8"));
    envelope.ciphertext = Buffer.from("tampered").toString("base64");
    await writeFile(path, JSON.stringify(envelope));
    await expect(store.read()).rejects.toThrow();
    const { chmod } = await import("node:fs/promises");
    await chmod(keyPath, 0o644);
    await expect(store.write(tokens)).rejects.toThrow("private regular files");
  });
});
