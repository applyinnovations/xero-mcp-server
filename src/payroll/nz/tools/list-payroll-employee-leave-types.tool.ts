import { z } from "zod";
import { listXeroPayrollEmployeeLeaveTypes } from "../handlers/list-xero-payroll-employee-leave-types.handler.js";
import { CreateXeroTool } from "../../../helpers/create-xero-tool.js";
import { EmployeeLeaveType } from "../types.js";

const ListPayrollEmployeeLeaveTypesTool = CreateXeroTool({
  name: "list-payroll-employee-leave-types",
  description:
    "New Zealand payroll. List all leave types available for a specific employee in Xero. This shows detailed information about the types of leave an employee can take, including schedule of accrual, leave type name, and entitlement.",
  access: "read",
  schema: {
    employeeId: z
      .string()
      .describe("The Xero employee ID to fetch leave types for"),
  },
  handler: async ({ employeeId }) => {
    const response = await listXeroPayrollEmployeeLeaveTypes(employeeId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing employee leave types: ${response.error}`,
          },
        ],
      };
    }

    const leaveTypes = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${leaveTypes?.length || 0} leave types for employee ${employeeId}:`,
        },
        ...(leaveTypes?.map((leaveType: EmployeeLeaveType) => ({
          type: "text" as const,
          text: [
            `Leave Type ID: ${leaveType.leaveTypeID || "Unknown"}`,
            `Schedule of Accrual: ${leaveType.scheduleOfAccrual || "Unknown"}`,
            leaveType.typeOfUnitsToAccrue
              ? `Type of Units: ${leaveType.typeOfUnitsToAccrue}`
              : null,
            leaveType.unitsAccruedAnnually
              ? `Units Accrued Annually: ${leaveType.unitsAccruedAnnually}`
              : null,
            leaveType.maximumToAccrue
              ? `Maximum To Accrue: ${leaveType.maximumToAccrue}`
              : null,
            leaveType.openingBalance
              ? `Opening Balance: ${leaveType.openingBalance}`
              : null,
            leaveType.rateAccruedHourly
              ? `Rate Accrued Hourly: ${leaveType.rateAccruedHourly}`
              : null,
            leaveType.scheduleOfAccrualDate
              ? `Accrual Date: ${leaveType.scheduleOfAccrualDate}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
});

export default ListPayrollEmployeeLeaveTypesTool;
