import { Timesheet } from "xero-node/dist/gen/model/payroll-nz/timesheet.js";

import { nzPayrollClient } from "../client.js";
import { formatError } from "../../../helpers/format-error.js";
import { XeroClientResponse } from "../../../types/tool-response.js";

/**
 * Get a single payroll timesheet from Xero
 */
export async function getXeroPayrollTimesheet(
  timesheetID: string,
): Promise<XeroClientResponse<Timesheet | null>> {
  try {
    const timesheet = await nzPayrollClient().getTimesheet(timesheetID);

    return {
      result: timesheet,
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
