import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

export const storedTokenSchema = z.object({
  access_token: z.string().min(1).max(16384),
  refresh_token: z.string().min(1).max(16384),
  expires_at: z.number().int().positive(),
  scope: z.string().optional(),
  reauthorizeRequired: z.boolean().optional(),
});
export type StoredTokens = z.infer<typeof storedTokenSchema>;
const envelopeSchema = z.object({ version: z.literal(1), iv: z.string(), tag: z.string(), ciphertext: z.string() });

async function privateFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 131072) {
      throw new Error("OAuth state and key files must be private regular files");
    }
    return await file.readFile("utf8");
  } finally { await file.close(); }
}

// One local filesystem and one configured grant. Crash leftovers fail closed;
// never guess that a lock is stale while another process could be refreshing.
export class EncryptedTokenStore {
  constructor(private readonly path: string, private readonly keyPath: string, private readonly clientId: string) {
    if (!isAbsolute(path) || !isAbsolute(keyPath)) throw new Error("OAuth state and key paths must be absolute");
    if (path === keyPath) throw new Error("OAuth state and key files must be separate");
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.path}.lock`;
    const deadline = Date.now() + 20000;
    while (true) {
      try { await mkdir(lockPath, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() >= deadline) throw new Error("OAuth refresh lock unavailable; inspect the state directory before retrying");
        await delay(25);
      }
    }
    try { return await operation(); }
    finally { await rm(lockPath, { recursive: true }); }
  }

  private async key(): Promise<Buffer> {
    const encoded = (await privateFile(this.keyPath)).trim();
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("OAuth encryption key must be a base64 encoded 32 byte key");
    return key;
  }

  async validateKey(): Promise<void> { await this.key(); }

  async hasState(): Promise<boolean> {
    try {
      const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { if (!(await file.stat()).isFile()) throw new Error("State must be a regular file"); }
      finally { await file.close(); }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async read(): Promise<StoredTokens> {
    const envelope = envelopeSchema.parse(JSON.parse(await privateFile(this.path)));
    const decipher = createDecipheriv("aes-256-gcm", await this.key(), Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(`xero-mcp-oauth-v1:${this.clientId}`));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    return storedTokenSchema.parse(JSON.parse(plaintext.toString("utf8")));
  }

  // Call under withLock. Do not return refreshed credentials until this succeeds.
  async write(tokens: StoredTokens): Promise<void> {
    const validated = storedTokenSchema.parse(tokens);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await this.key(), iv);
    cipher.setAAD(Buffer.from(`xero-mcp-oauth-v1:${this.clientId}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(validated), "utf8"), cipher.final()]);
    const envelope = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    const temporary = `${this.path}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(envelope) + "\n");
        await file.sync();
      } finally { await file.close(); }
      await rename(temporary, this.path);
      const directory = await open(dirname(this.path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
  }

  async initialize(tokens: StoredTokens): Promise<void> {
    await this.withLock(async () => {
      try { const file = await open(this.path, "r"); await file.close(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") { await this.write(tokens); return; }
        throw error;
      }
      throw new Error("OAuth state already exists; import refuses to replace a configured grant");
    });
  }
}
