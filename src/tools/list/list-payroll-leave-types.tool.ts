import { listXeroPayrollLeaveTypes } from "../../handlers/list-xero-payroll-leave-types.handler.js";
import { CreatePayrollTool } from "../../helpers/create-payroll-tool.js";
import type { PayrollLeaveType } from "../../payroll/operations.js";

const ListPayrollLeaveTypesTool = CreatePayrollTool({
  name: "list-payroll-leave-types",
  description: "Lists all available leave types in Xero Payroll. This provides information about all the leave categories configured in your Xero system, including statutory and organization-specific leave types.",
  access: "read",
  schema: {},
  handler: async () => {
    const response = await listXeroPayrollLeaveTypes();
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing payroll leave types: ${response.error}`,
          },
        ],
      };
    }

    const leaveTypes = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${leaveTypes?.length || 0} payroll leave types:`,
        },        ...(leaveTypes?.map((leaveType: PayrollLeaveType) => ({
          type: "text" as const,
          text: [
            `Leave Type: ${leaveType.name || "Unnamed"}`,
            `Leave Type ID: ${leaveType.leaveTypeID || "Unknown"}`,
            leaveType.isPaidLeave !== undefined ? `Is Paid Leave: ${leaveType.isPaidLeave ? 'Yes' : 'No'}` : null,
            leaveType.showOnPayslip !== undefined ? `Show On Payslip: ${leaveType.showOnPayslip ? 'Yes' : 'No'}` : null,
            "isActive" in leaveType && leaveType.isActive !== undefined ? `Is Active: ${leaveType.isActive ? 'Yes' : 'No'}` : null,
            leaveType.typeOfUnits ? `Type Of Units: ${leaveType.typeOfUnits}` : null,
            "typeOfUnitsToAccrue" in leaveType && leaveType.typeOfUnitsToAccrue ? `Type Of Units To Accrue: ${leaveType.typeOfUnitsToAccrue}` : null,
            "currentRecord" in leaveType ? `Current Record: ${leaveType.currentRecord}` : null,
            leaveType.updatedDateUTC ? `Last Updated: ${leaveType.updatedDateUTC}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
});

export default ListPayrollLeaveTypesTool;
