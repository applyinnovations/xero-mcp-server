import { updatePayrollTimesheetLine, type PayrollTimesheetLine } from "../payroll/operations.js";
import {
  TimesheetLine,
} from "xero-node/dist/gen/model/payroll-nz/timesheetLine.js";

import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";

/**
 * Update an existing timesheet line in a payroll timesheet in Xero
 */
export async function updateXeroPayrollTimesheetUpdateLine(
  timesheetID: string,
  timesheetLineID: string,
  timesheetLine: TimesheetLine
): Promise<XeroClientResponse<PayrollTimesheetLine | null>> {
  try {
    const updatedLine = await updatePayrollTimesheetLine(timesheetID, timesheetLineID, timesheetLine);

    return {
      result: updatedLine,
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
