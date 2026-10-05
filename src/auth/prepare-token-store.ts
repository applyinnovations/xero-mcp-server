import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { EncryptedTokenStore } from "./token-store.js";

interface Options {
  statePath: string;
  keyPath: string;
  clientId: string;
  keySourcePath?: string;
  allowOnboarding: boolean;
}

// A secret-manager projection may be a symlink or group-readable. Accept it
// only as an explicitly configured source; the live key/state remain private.
export async function prepareTokenStore(options: Options): Promise<void> {
  try {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error();
    const store = new EncryptedTokenStore(options.statePath, options.keyPath, options.clientId);
    if (options.keySourcePath) {
      if (options.keySourcePath === options.keyPath || options.keySourcePath === options.statePath) throw new Error();
      const source = await open(options.keySourcePath, constants.O_RDONLY);
      let key: string;
      try {
        const stat = await source.stat();
        if (!stat.isFile() || stat.size > 128) throw new Error();
        key = await source.readFile("utf8");
      } finally { await source.close(); }
      const destination = await open(options.keyPath, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        const stat = await destination.stat();
        if (!stat.isFile() || stat.uid !== uid) throw new Error();
        await destination.chmod(0o600);
        await destination.truncate(0);
        await destination.writeFile(key);
        await destination.sync();
      } finally { await destination.close(); }
    }
    await store.validateKey();
    const stateDirectory = dirname(options.statePath);
    await mkdir(stateDirectory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const directory = await open(stateDirectory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await directory.stat();
      if (!stat.isDirectory() || stat.uid !== uid) throw new Error();
      await directory.chmod(0o700);
      let state;
      try { state = await open(options.statePath, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && options.allowOnboarding) return;
        throw error;
      }
      try {
        const stat = await state.stat();
        if (!stat.isFile() || stat.uid !== uid) throw new Error();
        await state.chmod(0o600);
      } finally { await state.close(); }
    } finally { await directory.close(); }
    if ((await store.read()).reauthorizeRequired && !options.allowOnboarding) throw new Error();
  } catch { throw new Error("OAuth state initialization failed; check private files and configuration"); }
}
