import { z } from "zod";

import {
  getXeroPayrollTimesheet,
} from "../../handlers/get-xero-payroll-timesheet.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetPayrollTimesheetTool = CreateXeroTool({
  name: "get-timesheet",
  description: `Retrieve a single payroll timesheet from Xero by its ID.
This provides details such as the timesheet ID, employee ID, start and end dates, total hours, and the last updated date.`,
  support: "maintained",
  access: "read",
  schema: {
    timesheetID: z.string().describe("The ID of the timesheet to retrieve."),
  },
  handler: async (params: { timesheetID: string }) => {
    const { timesheetID } = params;
    const response = await getXeroPayrollTimesheet(timesheetID);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving timesheet: ${response.error}`,
          },
        ],
      };
    }

    const timesheet = response.result;

    if (!timesheet) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No timesheet found with ID: ${timesheetID}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Timesheet ID: ${timesheet.timesheetID}`,
            `Employee ID: ${timesheet.employeeID}`,
            `Start Date: ${timesheet.startDate}`,
            `End Date: ${timesheet.endDate}`,
            `Total Hours: ${timesheet.totalHours}`,
            `Last Updated: ${timesheet.updatedDateUTC}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
});

export default GetPayrollTimesheetTool;