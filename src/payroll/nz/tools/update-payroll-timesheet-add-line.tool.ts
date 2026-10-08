import { TimesheetLine } from "xero-node/dist/gen/model/payroll-nz/timesheetLine.js";
import { z } from "zod";
import { nzTimesheetLineSchema } from "../schemas.js";

import { updateXeroPayrollTimesheetAddLine } from "../handlers/update-xero-payroll-timesheet-add-line.handler.js";
import { CreateXeroTool } from "../../../helpers/create-xero-tool.js";

const AddTimesheetLineTool = CreateXeroTool({
  name: "add-timesheet-line",
  description: `New Zealand payroll. Add a new timesheet line to an existing payroll timesheet in Xero.`,
  access: "write",
  schema: {
    timesheetID: z.string().describe("The ID of the timesheet to update."),
    timesheetLine: nzTimesheetLineSchema,
  },
  handler: async (params: {
    timesheetID: string;
    timesheetLine: TimesheetLine;
  }) => {
    const { timesheetID, timesheetLine } = params;
    const response = await updateXeroPayrollTimesheetAddLine(
      timesheetID,
      timesheetLine,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error adding timesheet line: ${response.error}`,
          },
        ],
      };
    }

    const newLine = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully added timesheet line with date: ${newLine?.date}`,
        },
      ],
    };
  },
});

export default AddTimesheetLineTool;
