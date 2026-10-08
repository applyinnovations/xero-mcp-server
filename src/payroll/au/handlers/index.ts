import { auPayrollClient } from "../client.js";
import { formatError } from "../../../helpers/format-error.js";

export async function listXeroPayrollEmployees() {
  try {
    const result = await auPayrollClient().employees();
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function listXeroPayrollLeaveTypes() {
  try {
    const result = await auPayrollClient().leaveTypes();
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function listXeroPayrollEmployeeLeaveBalances(employeeId: string) {
  try {
    const result = await auPayrollClient().leaveBalances(employeeId);
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function listXeroPayrollTimesheets() {
  try {
    const result = await auPayrollClient().timesheets.getTimesheets();
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function getXeroPayrollTimesheet(timesheetID: string) {
  try {
    const result = await auPayrollClient().timesheets.getTimesheet(timesheetID);
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function createXeroPayrollTimesheet(input: unknown) {
  try {
    const result = await auPayrollClient().timesheets.createTimesheet(input);
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function updateXeroPayrollTimesheetAddLine(
  timesheetID: string,
  timesheetLine: unknown,
) {
  try {
    const result = await auPayrollClient().timesheets.createTimesheetLine(
      timesheetID,
      timesheetLine,
    );
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function updateXeroPayrollTimesheetUpdateLine(
  timesheetID: string,
  timesheetLineID: string,
  timesheetLine: unknown,
) {
  try {
    const result = await auPayrollClient().timesheets.updateTimesheetLine(
      timesheetID,
      timesheetLineID,
      timesheetLine,
    );
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function approveXeroPayrollTimesheet(timesheetID: string) {
  try {
    const result =
      await auPayrollClient().timesheets.approveTimesheet(timesheetID);
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function revertXeroPayrollTimesheet(timesheetID: string) {
  try {
    const result =
      await auPayrollClient().timesheets.revertTimesheet(timesheetID);
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}

export async function deleteXeroPayrollTimesheet(timesheetID: string) {
  try {
    await auPayrollClient().timesheets.deleteTimesheet(timesheetID);
    const result = true;
    return { isError: false as const, result, error: null };
  } catch (error) {
    return { isError: true as const, result: null, error: formatError(error) };
  }
}
