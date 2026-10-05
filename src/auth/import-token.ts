import { EncryptedTokenStore, storedTokenSchema } from "./token-store.js";

// Operator-only import of an already approved token set. Never called by MCP.
async function main() {
  const { XERO_TOKEN_FILE, XERO_TOKEN_KEY_FILE, XERO_CLIENT_ID } = process.env;
  if (!XERO_TOKEN_FILE || !XERO_TOKEN_KEY_FILE || !XERO_CLIENT_ID) throw new Error("OAuth import configuration is incomplete");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 131072) throw new Error("Token input exceeds size limit");
    chunks.push(chunk);
  }
  const tokens = storedTokenSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  await new EncryptedTokenStore(XERO_TOKEN_FILE, XERO_TOKEN_KEY_FILE, XERO_CLIENT_ID).initialize(tokens);
  console.error("Existing Xero token set imported into encrypted state");
}
main().catch(() => { console.error("Xero token import failed; check private state/key files and token input"); process.exitCode = 1; });
