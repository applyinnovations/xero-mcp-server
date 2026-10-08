import { nzPayrollClient } from "../client.js";
import { XeroClientResponse } from "../../../types/tool-response.js";
import { formatError } from "../../../helpers/format-error.js";
// Import the correct types - using the proper namespace
import { EmployeeLeave } from "../types.js";

/**
 * Internal function to fetch employee leave from Xero
 */

/**
 * List employee leave from Xero Payroll
 * @param employeeId The ID of the employee to retrieve leave for
 */
export async function listXeroPayrollEmployeeLeave(
  employeeId: string,
): Promise<XeroClientResponse<EmployeeLeave[]>> {
  try {
    const leave = await nzPayrollClient().fetchEmployeeLeave({ employeeId });

    if (!leave) {
      return {
        result: [],
        isError: false,
        error: null,
      };
    }

    return {
      result: leave,
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
