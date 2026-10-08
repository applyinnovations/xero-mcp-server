import {
  TimesheetLine,
} from "xero-node/dist/gen/model/payroll-nz/timesheetLine.js";
import { z } from "zod";
import { auTimesheetLineSchema } from "../../payroll/timesheet-schema.js";

import {
  updateXeroPayrollTimesheetUpdateLine,
} from "../../handlers/update-xero-payroll-timesheet-update-line.handler.js";
import { CreatePayrollTool } from "../../helpers/create-payroll-tool.js";

const UpdatePayrollTimesheetLineTool = CreatePayrollTool(region => ({
  name: "update-timesheet-line",
  description: `Update an existing timesheet line in a payroll timesheet in Xero.`,
  access: "write",
  schema: {
    timesheetID: z.string().describe("The ID of the timesheet to update."),
    timesheetLineID: z.string().describe("The ID of the timesheet line to update."),
    timesheetLine: (region === "AU" ? auTimesheetLineSchema : z.object({
      earningsRateID: z.string().describe("The ID of the earnings rate."),
      numberOfUnits: z.number().describe("The number of units for the timesheet line."),
      date: z.string().describe("The date for the timesheet line (YYYY-MM-DD)."),
    })).describe("The details of the timesheet line to update (AU supports optional trackingItemID)."),
  },
  handler: async (params: { timesheetID: string; timesheetLineID: string; timesheetLine: TimesheetLine }) => {
    const { timesheetID, timesheetLineID, timesheetLine } = params;
    const response = await updateXeroPayrollTimesheetUpdateLine(timesheetID, timesheetLineID, timesheetLine);

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
}));

export default UpdatePayrollTimesheetLineTool;
