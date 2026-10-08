import { z } from "zod";

import { approveXeroPayrollTimesheet } from "../handlers/approve-xero-payroll-timesheet.handler.js";
import { CreateXeroTool } from "../../../helpers/create-xero-tool.js";

const ApprovePayrollTimesheetTool = CreateXeroTool({
  name: "approve-timesheet",
  description: `New Zealand payroll. Approve a payroll timesheet in Xero by its ID.`,
  access: "write",
  schema: {
    timesheetID: z.string().describe("The ID of the timesheet to approve."),
  },
  handler: async (params: { timesheetID: string }) => {
    const { timesheetID } = params;
    const response = await approveXeroPayrollTimesheet(timesheetID);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error approving timesheet: ${response.error}`,
          },
        ],
      };
    }

    const timesheet = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully approved timesheet with ID: ${timesheet?.timesheetID}`,
        },
      ],
    };
  },
});

export default ApprovePayrollTimesheetTool;
