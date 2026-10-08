import { nzPayrollClient } from "../client.js";
import { formatError } from "../../../helpers/format-error.js";
import { XeroClientResponse } from "../../../types/tool-response.js";

/**
 * Delete an existing payroll timesheet in Xero
 */
export async function deleteXeroPayrollTimesheet(
  timesheetID: string,
): Promise<XeroClientResponse<boolean>> {
  try {
    await nzPayrollClient().deleteTimesheet(timesheetID);

    return {
      result: true,
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
