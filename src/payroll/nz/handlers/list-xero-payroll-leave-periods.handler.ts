import { nzPayrollClient } from "../client.js";
import { XeroClientResponse } from "../../../types/tool-response.js";
import { formatError } from "../../../helpers/format-error.js";
import { LeavePeriod } from "../types.js";

/**
 * Internal function to fetch employee leave periods from Xero
 */

/**
 * List employee leave periods from Xero Payroll
 * @param employeeId The ID of the employee to retrieve leave periods for
 * @param startDate Optional start date in YYYY-MM-DD format
 * @param endDate Optional end date in YYYY-MM-DD format
 */
export async function listXeroPayrollLeavePeriods(
  employeeId: string,
  startDate?: string,
  endDate?: string,
): Promise<XeroClientResponse<LeavePeriod[]>> {
  try {
    const periods = await nzPayrollClient().fetchLeavePeriods({
      employeeId,
      startDate,
      endDate,
    });

    if (!periods) {
      return {
        result: [],
        isError: false,
        error: null,
      };
    }

    return {
      result: periods,
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
