import { payrollLeaveTypes } from "../payroll/operations.js";
import type { PayrollLeaveType } from "../payroll/operations.js";
import { formatError } from "../helpers/format-error.js";
import type { XeroClientResponse } from "../types/tool-response.js";

export async function listXeroPayrollLeaveTypes(): Promise<XeroClientResponse<PayrollLeaveType[]>> {
  try {
    return { result: await payrollLeaveTypes(), isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
