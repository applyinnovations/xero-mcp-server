import { z } from "zod";
import { CreateXeroTool } from "../../../helpers/create-xero-tool.js";
import * as handlers from "../handlers/index.js";
import { auTimesheetShape, auTimesheetLineSchema } from "../schemas.js";

const Tool0 = CreateXeroTool({
  name: "list-payroll-employees",
  access: "read",
  description:
    "Australian payroll. List Australian payroll employees. Fields include employeeID, firstName, lastName, email, phone, startDate, status.",
  schema: {},
  handler: async () => {
    const response = await handlers.listXeroPayrollEmployees();
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            response.result.map((e) => ({
              employeeID: e.employeeID,
              firstName: e.firstName,
              lastName: e.lastName,
              email: e.email,
              phone: e.phone,
              startDate: e.startDate,
              status: e.status,
            })),
          ),
        },
      ],
    };
  },
});

const Tool1 = CreateXeroTool({
  name: "list-payroll-leave-types",
  access: "read",
  description:
    "Australian payroll. List Australian payroll leave types from AU PayItems, including leaveTypeID, name, typeOfUnits and currentRecord.",
  schema: {},
  handler: async () => {
    const response = await handlers.listXeroPayrollLeaveTypes();
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});

const Tool2 = CreateXeroTool({
  name: "list-payroll-employee-leave-balances",
  access: "read",
  description:
    "Australian payroll. Read Australian employee leave balances with leaveTypeID, leaveName, numberOfUnits and typeOfUnits.",
  schema: { employeeId: z.string().uuid() },
  handler: async (params) => {
    const response = await handlers.listXeroPayrollEmployeeLeaveBalances(
      params.employeeId,
    );
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});

const Tool3 = CreateXeroTool({
  name: "list-timesheets",
  access: "read",
  description:
    "Australian payroll. List Australian Timesheets 2.0. Each record has timesheetID, employeeID, payrollCalendarID, startDate, endDate, status, totalHours and dated scalar timesheetLines.",
  schema: {},
  handler: async () => {
    const response = await handlers.listXeroPayrollTimesheets();
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});

const Tool4 = CreateXeroTool({
  name: "get-timesheet",
  access: "read",
  description:
    "Australian payroll. Read an Australian Timesheet 2.0 with status, totalHours and dated scalar timesheetLines.",
  schema: { timesheetID: z.string().uuid() },
  handler: async (params) => {
    const response = await handlers.getXeroPayrollTimesheet(params.timesheetID);
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});

const Tool5 = CreateXeroTool({
  name: "create-timesheet",
  access: "write",
  description:
    "Australian payroll. Create an Australian Timesheet 2.0 using an inclusive period, payrollCalendarID and dated scalar lines. Returns the validated AU timesheet receipt.",
  schema: auTimesheetShape,
  handler: async (params) => {
    const response = await handlers.createXeroPayrollTimesheet({
      employeeID: params.employeeID,
      payrollCalendarID: params.payrollCalendarID,
      startDate: params.startDate,
      endDate: params.endDate,
      timesheetLines: params.timesheetLines,
    });
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});

const Tool6 = CreateXeroTool({
  name: "add-timesheet-line",
  access: "write",
  description:
    "Australian payroll. Add a dated scalar AU Timesheets 2.0 line, with optional trackingItemID. Returns the validated line receipt.",
  schema: {
    timesheetID: z.string().uuid(),
    timesheetLine: auTimesheetLineSchema,
  },
  handler: async (params) => {
    const response = await handlers.updateXeroPayrollTimesheetAddLine(
      params.timesheetID,
      params.timesheetLine,
    );
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});

const Tool7 = CreateXeroTool({
  name: "update-timesheet-line",
  access: "write",
  description:
    "Australian payroll. Update a dated scalar AU Timesheets 2.0 line, with optional trackingItemID. Returns the validated line receipt.",
  schema: {
    timesheetID: z.string().uuid(),
    timesheetLineID: z.string().uuid(),
    timesheetLine: auTimesheetLineSchema,
  },
  handler: async (params) => {
    const response = await handlers.updateXeroPayrollTimesheetUpdateLine(
      params.timesheetID,
      params.timesheetLineID,
      params.timesheetLine,
    );
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});

const Tool8 = CreateXeroTool({
  name: "approve-timesheet",
  access: "write",
  description:
    "Australian payroll. Approve an Australian Timesheet 2.0. Returns the validated AU timesheet receipt.",
  schema: { timesheetID: z.string().uuid() },
  handler: async (params) => {
    const response = await handlers.approveXeroPayrollTimesheet(
      params.timesheetID,
    );
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});

const Tool9 = CreateXeroTool({
  name: "revert-timesheet",
  access: "write",
  description:
    "Australian payroll. Revert an Australian Timesheet 2.0 to draft. Returns the validated AU timesheet receipt.",
  schema: { timesheetID: z.string().uuid() },
  handler: async (params) => {
    const response = await handlers.revertXeroPayrollTimesheet(
      params.timesheetID,
    );
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});

const Tool10 = CreateXeroTool({
  name: "delete-timesheet",
  access: "write",
  description:
    "Australian payroll. Delete an Australian Timesheet 2.0. Success requires the provider OK envelope.",
  schema: { timesheetID: z.string().uuid() },
  handler: async (params) => {
    const response = await handlers.deleteXeroPayrollTimesheet(
      params.timesheetID,
    );
    if (response.isError)
      return {
        isError: true,
        content: [{ type: "text" as const, text: response.error }],
      };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
});
export const auPayrollTools = Object.freeze([
  Tool0,
  Tool1,
  Tool2,
  Tool3,
  Tool4,
  Tool5,
  Tool6,
  Tool7,
  Tool8,
  Tool9,
  Tool10,
]);
