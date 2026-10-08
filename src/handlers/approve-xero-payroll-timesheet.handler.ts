import { approvePayrollTimesheet, type PayrollTimesheet } from "../payroll/operations.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";

/**
 * Approve a payroll timesheet in Xero
 */
export async function approveXeroPayrollTimesheet(timesheetID: string): Promise<
  XeroClientResponse<PayrollTimesheet | null>
> {
  try {
    const approvedTimesheet = await approvePayrollTimesheet(timesheetID);

    return {
      result: approvedTimesheet,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
