import { nzPayrollClient } from "../client.js";
import { XeroClientResponse } from "../../../types/tool-response.js";
import { formatError } from "../../../helpers/format-error.js";
import { EmployeeLeaveBalance } from "../types.js";

/**
 * Internal function to fetch employee leave balances from Xero
 */

/**
 * List employee leave balances from Xero Payroll
 * @param employeeId The ID of the employee to retrieve leave balances for
 */
export async function listXeroPayrollEmployeeLeaveBalances(
  employeeId: string,
): Promise<XeroClientResponse<EmployeeLeaveBalance[]>> {
  try {
    const leaveBalances =
      await nzPayrollClient().fetchEmployeeLeaveBalances(employeeId);

    if (!leaveBalances) {
      return {
        result: [],
        isError: false,
        error: null,
      };
    }

    return {
      result: leaveBalances,
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
