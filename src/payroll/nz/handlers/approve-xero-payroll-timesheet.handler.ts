import { Timesheet } from "xero-node/dist/gen/model/payroll-nz/timesheet.js";

import { nzPayrollClient } from "../client.js";
import { formatError } from "../../../helpers/format-error.js";
import { XeroClientResponse } from "../../../types/tool-response.js";

/**
 * Approve a payroll timesheet in Xero
 */
export async function approveXeroPayrollTimesheet(
  timesheetID: string,
): Promise<XeroClientResponse<Timesheet | null>> {
  try {
    const approvedTimesheet =
      await nzPayrollClient().approveTimesheet(timesheetID);

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
