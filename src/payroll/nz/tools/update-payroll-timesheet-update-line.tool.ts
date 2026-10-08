import { TimesheetLine } from "xero-node/dist/gen/model/payroll-nz/timesheetLine.js";
import { z } from "zod";
import { nzTimesheetLineSchema } from "../schemas.js";

import { updateXeroPayrollTimesheetUpdateLine } from "../handlers/update-xero-payroll-timesheet-update-line.handler.js";
import { CreateXeroTool } from "../../../helpers/create-xero-tool.js";

const UpdatePayrollTimesheetLineTool = CreateXeroTool({
  name: "update-timesheet-line",
  description: `New Zealand payroll. Update an existing timesheet line in a payroll timesheet in Xero.`,
  access: "write",
  schema: {
    timesheetID: z.string().describe("The ID of the timesheet to update."),
    timesheetLineID: z
      .string()
      .describe("The ID of the timesheet line to update."),
    timesheetLine: nzTimesheetLineSchema,
  },
  handler: async (params: {
    timesheetID: string;
    timesheetLineID: string;
    timesheetLine: TimesheetLine;
  }) => {
    const { timesheetID, timesheetLineID, timesheetLine } = params;
    const response = await updateXeroPayrollTimesheetUpdateLine(
      timesheetID,
      timesheetLineID,
      timesheetLine,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating timesheet line: ${response.error}`,
          },
        ],
      };
    }

    const updatedLine = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully updated timesheet line with date: ${updatedLine?.date}`,
        },
      ],
    };
  },
});

export default UpdatePayrollTimesheetLineTool;
