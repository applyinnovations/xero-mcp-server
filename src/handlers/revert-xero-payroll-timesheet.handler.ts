import { revertPayrollTimesheet, type PayrollTimesheet } from "../payroll/operations.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";

/**
 * Revert a payroll timesheet to draft in Xero
 */
export async function revertXeroPayrollTimesheet(timesheetID: string): Promise<
  XeroClientResponse<PayrollTimesheet | null>
> {
  try {
    const revertedTimesheet = await revertPayrollTimesheet(timesheetID);

    return {
      result: revertedTimesheet,
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
