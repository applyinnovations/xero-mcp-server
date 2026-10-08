import { Timesheet } from "xero-node/dist/gen/model/payroll-nz/timesheet.js";

import { nzPayrollClient } from "../client.js";
import { formatError } from "../../../helpers/format-error.js";
import { XeroClientResponse } from "../../../types/tool-response.js";

/**
 * Create a payroll timesheet in Xero
 */
export async function createXeroPayrollTimesheet(
  timesheet: Timesheet,
): Promise<XeroClientResponse<Timesheet | null>> {
  try {
    const newTimesheet = await nzPayrollClient().createTimesheet(timesheet);

    return {
      result: newTimesheet,
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
