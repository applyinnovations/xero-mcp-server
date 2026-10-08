import { TimesheetLine } from "xero-node/dist/gen/model/payroll-nz/timesheetLine.js";

import { nzPayrollClient } from "../client.js";
import { formatError } from "../../../helpers/format-error.js";
import { XeroClientResponse } from "../../../types/tool-response.js";

/**
 * Add a timesheet line to an existing payroll timesheet in Xero
 */
export async function updateXeroPayrollTimesheetAddLine(
  timesheetID: string,
  timesheetLine: TimesheetLine,
): Promise<XeroClientResponse<TimesheetLine | null>> {
  try {
    const newLine = await nzPayrollClient().addTimesheetLine(
      timesheetID,
      timesheetLine,
    );

    return {
      result: newLine,
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
