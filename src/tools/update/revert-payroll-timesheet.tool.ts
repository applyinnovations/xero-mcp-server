import { z } from "zod";

import {
  revertXeroPayrollTimesheet,
} from "../../handlers/revert-xero-payroll-timesheet.handler.js";
import { CreatePayrollTool } from "../../helpers/create-payroll-tool.js";

const RevertPayrollTimesheetTool = CreatePayrollTool({
  name: "revert-timesheet",
  description: `Revert a payroll timesheet to draft in Xero by its ID.`,
  access: "write",
  schema: {
    timesheetID: z.string().describe("The ID of the timesheet to revert."),
  },
  handler: async (params: { timesheetID: string }) => {
    const { timesheetID } = params;
    const response = await revertXeroPayrollTimesheet(timesheetID);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error reverting timesheet: ${response.error}`,
          },
        ],
      };
    }

    const timesheet = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully reverted timesheet with ID: ${timesheet?.timesheetID} to draft.`,
        },
      ],
    };
  },
});

export default RevertPayrollTimesheetTool;