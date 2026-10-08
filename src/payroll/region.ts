export type PayrollRegion = "NZ" | "AU";

/** Payroll is a process-wide selection; an omitted variable preserves NZ behavior. */
export function configuredPayrollRegion(): PayrollRegion {
  const value = process.env.XERO_PAYROLL_REGION ?? "NZ";
  if (value !== "NZ" && value !== "AU") {
    throw new Error(
      "XERO_PAYROLL_REGION must be NZ or AU (unset defaults to NZ)",
    );
  }
  return value;
}
