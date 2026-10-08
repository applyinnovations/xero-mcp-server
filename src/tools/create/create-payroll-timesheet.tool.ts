import { timesheetShape } from "../../payroll/timesheet-schema.js";

import {
  createXeroPayrollTimesheet,
} from "../../handlers/create-xero-payroll-timesheet.handler.js";
import { CreatePayrollTool } from "../../helpers/create-payroll-tool.js";

const CreatePayrollTimesheetTool = CreatePayrollTool(region => ({
  name: "create-timesheet",
  description: `Create a new payroll timesheet in Xero.
NZ and AU Timesheets 2.0 require payrollCalendarID and dated scalar-unit lines. AU also accepts trackingItemID. AU Timesheets 1.0 daily unit arrays are not accepted.`,
  access: "write",
  schema: timesheetShape(region),
  handler: async params => {
    // Transport selection is not a payroll API request field.
    const input = { ...params } as typeof params & { tenantId?: string };
    delete input.tenantId;
    const response = await createXeroPayrollTimesheet(input);

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
}));

export default CreatePayrollTimesheetTool;
