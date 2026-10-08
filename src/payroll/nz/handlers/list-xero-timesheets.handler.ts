import { Timesheet } from "xero-node/dist/gen/model/payroll-nz/timesheet.js";

import { nzPayrollClient } from "../client.js";
import { formatError } from "../../../helpers/format-error.js";
import { XeroClientResponse } from "../../../types/tool-response.js";

/**
 * List all payroll timesheets from Xero
 */
export async function listXeroPayrollTimesheets(): Promise<
  XeroClientResponse<Timesheet[]>
> {
  try {
    const timesheets = await nzPayrollClient().getTimesheets();

    return {
      result: timesheets,
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
