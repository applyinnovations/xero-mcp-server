import { nzPayrollClient } from "../client.js";
import { XeroClientResponse } from "../../../types/tool-response.js";
import { formatError } from "../../../helpers/format-error.js";
import { Employee } from "../types.js";

/**
 * List all payroll employees from Xero
 */
export async function listXeroPayrollEmployees(): Promise<
  XeroClientResponse<Employee[]>
> {
  try {
    const employees = await nzPayrollClient().getPayrollEmployees();

    return {
      result: employees,
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
