import { payrollEmployees } from "../payroll/operations.js";
import type { PayrollEmployee } from "../payroll/operations.js";
import { formatError } from "../helpers/format-error.js";
import type { XeroClientResponse } from "../types/tool-response.js";

export async function listXeroPayrollEmployees(): Promise<XeroClientResponse<PayrollEmployee[]>> {
  try {
    return { result: await payrollEmployees(), isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
