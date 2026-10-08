import { Timesheet } from "xero-node/dist/gen/model/payroll-nz/timesheet.js";

import { nzPayrollClient } from "../client.js";
import { formatError } from "../../../helpers/format-error.js";
import { XeroClientResponse } from "../../../types/tool-response.js";

/**
 * Revert a payroll timesheet to draft in Xero
 */
export async function revertXeroPayrollTimesheet(
  timesheetID: string,
): Promise<XeroClientResponse<Timesheet | null>> {
  try {
    const revertedTimesheet =
      await nzPayrollClient().revertTimesheet(timesheetID);

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
