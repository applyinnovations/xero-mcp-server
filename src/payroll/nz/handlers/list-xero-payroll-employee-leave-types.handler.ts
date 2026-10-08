import { nzPayrollClient } from "../client.js";
import { XeroClientResponse } from "../../../types/tool-response.js";
import { formatError } from "../../../helpers/format-error.js";
import { EmployeeLeaveType } from "../types.js";

/**
 * Internal function to fetch employee leave types from Xero
 */

/**
 * List employee leave types from Xero Payroll
 * @param employeeId The ID of the employee to retrieve leave types for
 */
export async function listXeroPayrollEmployeeLeaveTypes(
  employeeId: string,
): Promise<XeroClientResponse<EmployeeLeaveType[]>> {
  try {
    const leaveTypes =
      await nzPayrollClient().fetchEmployeeLeaveTypes(employeeId);

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
