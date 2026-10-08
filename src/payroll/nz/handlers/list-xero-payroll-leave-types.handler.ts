import { nzPayrollClient } from "../client.js";
import { XeroClientResponse } from "../../../types/tool-response.js";
import { formatError } from "../../../helpers/format-error.js";
import { LeaveType } from "../types.js";

/**
 * Internal function to fetch leave types from Xero
 */

/**
 * List all leave types from Xero Payroll
 */
export async function listXeroPayrollLeaveTypes(): Promise<
  XeroClientResponse<LeaveType[]>
> {
  try {
    const leaveTypes = await nzPayrollClient().fetchLeaveTypes();

    if (!leaveTypes) {
      return {
        result: [],
        isError: false,
        error: null,
      };
    }

    return {
      result: leaveTypes,
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
