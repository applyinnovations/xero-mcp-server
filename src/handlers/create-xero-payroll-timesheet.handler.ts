import { createPayrollTimesheet } from "../payroll/operations.js";
import type { PayrollTimesheet } from "../payroll/operations.js";
import { formatError } from "../helpers/format-error.js";
import type { XeroClientResponse } from "../types/tool-response.js";

export async function createXeroPayrollTimesheet(timesheet: unknown): Promise<XeroClientResponse<PayrollTimesheet | null>> {
  try {
    return { result: await createPayrollTimesheet(timesheet), isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
