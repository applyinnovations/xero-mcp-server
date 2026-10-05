import { AsyncLocalStorage } from "node:async_hooks";
import type { BankRecodeService } from "./bank-recode-service.js";
export interface RecodeContext { service: BankRecodeService; subject: string; clientId: unknown; canApply: boolean }
const context = new AsyncLocalStorage<RecodeContext>();
export function runWithRecodeContext<T>(authority: RecodeContext | undefined, callback: () => T): T {
  return authority ? context.run(authority, callback) : callback();
}
export function recodeContext(): RecodeContext {
  const authority = context.getStore();
  if (!authority) throw new Error("Bank coding is not configured for this HTTP request");
  return authority;
}
