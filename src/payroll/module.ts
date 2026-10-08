import type { ToolBuilder } from "../types/tool-definition.js";
import { configuredPayrollRegion, type PayrollRegion } from "./region.js";
import { auPayrollTools } from "./au/tools/index.js";
import { nzPayrollTools } from "./nz/tools/index.js";

export interface PayrollModule {
  readonly region: PayrollRegion;
  readonly tools: readonly ToolBuilder[];
}
// Call after environment loading, at server construction. Never select at module import time.
export function selectPayrollModule(
  region: PayrollRegion = configuredPayrollRegion(),
): PayrollModule {
  if (region === "NZ") return Object.freeze({ region, tools: nzPayrollTools });
  if (region === "AU") return Object.freeze({ region, tools: auPayrollTools });
  throw new Error(
    "XERO_PAYROLL_REGION must be NZ or AU (unset defaults to NZ)",
  );
}
