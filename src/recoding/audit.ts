import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

// Two exclusive files per operation: fsynced intent before POST, then outcome.
// A crash cannot overwrite the original approved before/diff evidence.
export async function writeRecodeAudit(directory: string, id: string, phase: "intent" | "result", record: unknown): Promise<void> {
  if (!isAbsolute(directory) || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid audit path");
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  const root = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await root.stat();
    if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error("Audit directory must be private and owned by the service");
    const file = await open(join(directory, `${id}.${phase}.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(JSON.stringify(record) + "\n"); await file.sync(); }
    finally { await file.close(); }
    await root.sync();
  } finally { await root.close(); }
}
