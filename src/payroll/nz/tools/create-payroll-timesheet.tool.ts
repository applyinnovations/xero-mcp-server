import { nzTimesheetShape } from "../schemas.js";

import { createXeroPayrollTimesheet } from "../handlers/create-xero-payroll-timesheet.handler.js";
import { CreateXeroTool } from "../../../helpers/create-xero-tool.js";

const CreatePayrollTimesheetTool = CreateXeroTool({
  name: "create-timesheet",
  description: `New Zealand payroll. Create a new payroll timesheet in Xero.
This allows you to specify details such as the employee ID, payroll calendar ID, start and end dates, and timesheet lines.`,
  access: "write",
  schema: nzTimesheetShape,
  handler: async (params) => {
    const response = await createXeroPayrollTimesheet({
      employeeID: params.employeeID,
      payrollCalendarID: params.payrollCalendarID,
      startDate: params.startDate,
      endDate: params.endDate,
      timesheetLines: params.timesheetLines,
    });

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating timesheet: ${response.error}`,
          },
        ],
      };
    }

    const timesheet = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully created timesheet with ID: ${timesheet?.timesheetID}`,
        },
      ],
    };
  },
});

export default CreatePayrollTimesheetTool;
