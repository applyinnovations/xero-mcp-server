export type PayrollRegion = "NZ" | "AU";

/** Payroll is a process-wide selection; an omitted variable preserves NZ behavior. */
export function configuredPayrollRegion(): PayrollRegion {
  const value = process.env.XERO_PAYROLL_REGION ?? "NZ";
  if (value !== "NZ" && value !== "AU") {
    throw new Error("XERO_PAYROLL_REGION must be NZ or AU (unset defaults to NZ)");
  }
  return value;
}

export const nzOnlyPayrollTools = new Set([
  "list-payroll-employee-leave", "list-payroll-employee-leave-types",
  "list-payroll-leave-periods", "add-timesheet-line", "update-timesheet-line",
  "approve-timesheet", "revert-timesheet", "delete-timesheet",
]);

export function assertPayrollOperation(region: PayrollRegion, tool: string): void {
  if (region === "AU" && nzOnlyPayrollTools.has(tool)) {
    throw new Error(`${tool} is not supported for XERO_PAYROLL_REGION=AU. This tool implements the NZ payroll contract; no NZ fallback is performed.`);
  }
}
