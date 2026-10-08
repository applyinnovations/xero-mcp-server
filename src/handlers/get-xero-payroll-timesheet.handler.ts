import { payrollTimesheet } from "../payroll/operations.js";
import type { PayrollTimesheet } from "../payroll/operations.js";
import { formatError } from "../helpers/format-error.js";
import type { XeroClientResponse } from "../types/tool-response.js";

export async function getXeroPayrollTimesheet(timesheetID: string): Promise<XeroClientResponse<PayrollTimesheet | null>> {
  try {
    return { result: await payrollTimesheet(timesheetID), isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
