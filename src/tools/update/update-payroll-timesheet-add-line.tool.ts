import {
  TimesheetLine,
} from "xero-node/dist/gen/model/payroll-nz/timesheetLine.js";
import { z } from "zod";
import { auTimesheetLineSchema } from "../../payroll/timesheet-schema.js";

import {
  updateXeroPayrollTimesheetAddLine,
} from "../../handlers/update-xero-payroll-timesheet-add-line.handler.js";
import { CreatePayrollTool } from "../../helpers/create-payroll-tool.js";

const AddTimesheetLineTool = CreatePayrollTool(region => ({
  name: "add-timesheet-line",
  description: `Add a new timesheet line to an existing payroll timesheet in Xero.`,
  access: "write",
  schema: {
    timesheetID: z.string().describe("The ID of the timesheet to update."),
    timesheetLine: (region === "AU" ? auTimesheetLineSchema : z.object({
      earningsRateID: z.string().describe("The ID of the earnings rate."),
      numberOfUnits: z.number().describe("The number of units for the timesheet line."),
      date: z.string().describe("The date for the timesheet line (YYYY-MM-DD)."),
    })).describe("The details of the timesheet line to add (AU supports optional trackingItemID)."),
  },
  handler: async (params: { timesheetID: string; timesheetLine: TimesheetLine }) => {
    const { timesheetID, timesheetLine } = params;
    const response = await updateXeroPayrollTimesheetAddLine(timesheetID, timesheetLine);

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
}));

export default AddTimesheetLineTool;
