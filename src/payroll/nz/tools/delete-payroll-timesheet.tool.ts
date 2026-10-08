import { z } from "zod";

import { deleteXeroPayrollTimesheet } from "../handlers/delete-xero-payroll-timesheet.handler.js";
import { CreateXeroTool } from "../../../helpers/create-xero-tool.js";

const DeletePayrollTimesheetTool = CreateXeroTool({
  name: "delete-timesheet",
  description: `New Zealand payroll. Delete an existing payroll timesheet in Xero by its ID.`,
  access: "write",
  schema: {
    timesheetID: z.string().describe("The ID of the timesheet to delete."),
  },
  handler: async (params: { timesheetID: string }) => {
    const { timesheetID } = params;
    const response = await deleteXeroPayrollTimesheet(timesheetID);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error deleting timesheet: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully deleted timesheet with ID: ${timesheetID}`,
        },
      ],
    };
  },
});

export default DeletePayrollTimesheetTool;
