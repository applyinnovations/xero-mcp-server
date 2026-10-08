import { payrollLeaveBalances } from "../payroll/operations.js";
import type { EmployeeLeaveBalance } from "../types/payroll-nz-types.js";
import { formatError } from "../helpers/format-error.js";
import type { XeroClientResponse } from "../types/tool-response.js";

export async function listXeroPayrollEmployeeLeaveBalances(employeeId: string): Promise<XeroClientResponse<EmployeeLeaveBalance[]>> {
  try {
    return { result: await payrollLeaveBalances(employeeId), isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
