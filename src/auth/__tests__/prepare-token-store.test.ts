import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTokenStore } from "../prepare-token-store.js";
import { EncryptedTokenStore } from "../token-store.js";

let directory: string;
let options: Parameters<typeof prepareTokenStore>[0];
let store: EncryptedTokenStore;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "xero-startup-fixture-"));
  const source = join(directory, "projected-key");
  await writeFile(source, Buffer.alloc(32, 7).toString("base64"), { mode: 0o444 });
  await symlink(source, join(directory, "projection"));
  options = { statePath: join(directory, "oauth/state.json"), keyPath: join(directory, "private-key"),
    keySourcePath: join(directory, "projection"), clientId: "fixture", allowOnboarding: true };
  store = new EncryptedTokenStore(options.statePath, options.keyPath, options.clientId);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it("prepares a private key and empty state for onboarding from a projected source", async () => {
  await prepareTokenStore(options);
  expect((await stat(options.keyPath)).mode & 0o777).toBe(0o600);
  expect((await stat(join(directory, "oauth"))).mode & 0o777).toBe(0o700);
  expect(await store.hasState()).toBe(false);
  await expect(prepareTokenStore({ ...options, allowOnboarding: false })).rejects.toThrow("OAuth state initialization failed");
});

it("preserves rotated/revoked state across startup and rejects a changed key", async () => {
  await prepareTokenStore(options);
  const tokens = { access_token: "invalid-fixture", refresh_token: "invalid-rotated-fixture", expires_at: 1, reauthorizeRequired: true };
  await store.initialize(tokens);
  const envelope = await readFile(options.statePath);
  await chmod(options.statePath, 0o660);
  await chmod(join(directory, "oauth"), 0o770);
  await prepareTokenStore(options);
  expect((await stat(options.statePath)).mode & 0o777).toBe(0o600);
  expect(await readFile(options.statePath)).toEqual(envelope);
  expect(await store.read()).toEqual(tokens);
  await expect(prepareTokenStore({ ...options, allowOnboarding: false })).rejects.toThrow();
  await chmod(join(directory, "projected-key"), 0o600);
  await writeFile(join(directory, "projected-key"), Buffer.alloc(32, 8).toString("base64"));
  await expect(prepareTokenStore(options)).rejects.toThrow();
  expect(await readFile(options.statePath)).toEqual(envelope);
});

it("rejects symlink destinations while accepting a separately configured projection", async () => {
  await symlink(join(directory, "projected-key"), options.keyPath);
  await expect(prepareTokenStore(options)).rejects.toThrow();
  await rm(options.keyPath);
  await prepareTokenStore(options);
  await symlink(join(directory, "projected-key"), options.statePath);
  await expect(prepareTokenStore(options)).rejects.toThrow();
  await rm(options.statePath);
  await rm(join(directory, "oauth"), { recursive: true });
  await mkdir(join(directory, "other"));
  await symlink(join(directory, "other"), join(directory, "oauth"));
  await expect(prepareTokenStore(options)).rejects.toThrow();
});
