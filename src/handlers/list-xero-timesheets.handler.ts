import { payrollTimesheets } from "../payroll/operations.js";
import type { PayrollTimesheet } from "../payroll/operations.js";
import { formatError } from "../helpers/format-error.js";
import type { XeroClientResponse } from "../types/tool-response.js";

export async function listXeroPayrollTimesheets(): Promise<XeroClientResponse<PayrollTimesheet[]>> {
  try {
    return { result: await payrollTimesheets(), isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
