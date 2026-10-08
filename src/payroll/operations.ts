import { xeroClient } from "../clients/xero-client.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import type { Employee as NzEmployee } from "../types/payroll-nz-types.js";
import type { Employee as AuEmployee } from "xero-node/dist/gen/model/payroll-au/employee.js";
import type { Timesheet as NzTimesheet } from "xero-node/dist/gen/model/payroll-nz/timesheet.js";
import type { Timesheet as AuTimesheet } from "xero-node/dist/gen/model/payroll-au/timesheet.js";
import type { LeaveType as AuLeaveType } from "xero-node/dist/gen/model/payroll-au/leaveType.js";
import type { LeaveType, EmployeeLeaveBalance } from "../types/payroll-nz-types.js";
import { auTimesheetSchema, nzTimesheetSchema } from "./timesheet-schema.js";

export type PayrollEmployee = NzEmployee | AuEmployee;
export type PayrollTimesheet = NzTimesheet | AuTimesheet;
export type PayrollLeaveType = LeaveType | AuLeaveType;

export async function payrollEmployees(): Promise<PayrollEmployee[]> {
  await xeroClient.authenticate();
  if (xeroClient.payrollRegion === "AU") {
    const response = await xeroClient.payrollAUApi.getEmployees(xeroClient.tenantId, undefined, undefined, undefined, undefined, getClientHeaders());
    return response.body.employees ?? [];
  }
  const response = await xeroClient.payrollNZApi.getEmployees(xeroClient.tenantId, undefined, undefined, getClientHeaders());
  return response.body.employees ?? [];
}

export async function payrollTimesheets(): Promise<PayrollTimesheet[]> {
  await xeroClient.authenticate();
  if (xeroClient.payrollRegion === "AU") {
    return (await xeroClient.payrollAUApi.getTimesheets(xeroClient.tenantId)).body.timesheets ?? [];
  }
  return (await xeroClient.payrollNZApi.getTimesheets(xeroClient.tenantId, undefined, undefined)).body.timesheets ?? [];
}

export async function payrollTimesheet(id: string): Promise<PayrollTimesheet | null> {
  await xeroClient.authenticate();
  if (xeroClient.payrollRegion === "AU") return (await xeroClient.payrollAUApi.getTimesheet(xeroClient.tenantId, id)).body.timesheet ?? null;
  return (await xeroClient.payrollNZApi.getTimesheet(xeroClient.tenantId, id)).body.timesheet ?? null;
}

export async function createPayrollTimesheet(input: unknown): Promise<PayrollTimesheet | null> {
  // Validate the selected schema before authentication or transport. Never cast NZ payloads to AU.
  if (xeroClient.payrollRegion === "AU") {
    const timesheet = auTimesheetSchema.parse(input);
    await xeroClient.authenticate();
    return (await xeroClient.payrollAUApi.createTimesheet(xeroClient.tenantId, [timesheet])).body.timesheets?.[0] ?? null;
  }
  const timesheet = nzTimesheetSchema.parse(input);
  await xeroClient.authenticate();
  return (await xeroClient.payrollNZApi.createTimesheet(xeroClient.tenantId, timesheet)).body.timesheet ?? null;
}

export async function payrollLeaveTypes(): Promise<PayrollLeaveType[]> {
  await xeroClient.authenticate();
  if (xeroClient.payrollRegion === "AU") return (await xeroClient.payrollAUApi.getPayItems(xeroClient.tenantId, undefined, undefined, undefined, undefined, getClientHeaders())).body.payItems?.leaveTypes ?? [];
  return (await xeroClient.payrollNZApi.getLeaveTypes(xeroClient.tenantId, undefined, undefined, getClientHeaders())).body.leaveTypes ?? [];
}

export async function payrollLeaveBalances(employeeId: string): Promise<EmployeeLeaveBalance[]> {
  if (!employeeId) throw new Error("Employee ID is required to fetch employee leave balances");
  await xeroClient.authenticate();
  if (xeroClient.payrollRegion === "AU") {
    const employees = (await xeroClient.payrollAUApi.getEmployee(xeroClient.tenantId, employeeId, getClientHeaders())).body.employees;
    const employee = employees?.find(item => item.employeeID === employeeId);
    if (!employee) throw new Error("AU employee response does not contain the requested employee");
    return (employee.leaveBalances ?? []).map(balance => ({
      leaveTypeID: balance.leaveTypeID, name: balance.leaveName,
      balance: balance.numberOfUnits, typeOfUnits: balance.typeOfUnits,
    }));
  }
  return (await xeroClient.payrollNZApi.getEmployeeLeaveBalances(xeroClient.tenantId, employeeId, getClientHeaders())).body.leaveBalances ?? [];
}

export function timesheetHours(value: PayrollTimesheet): number | undefined {
  return (value as NzTimesheet).totalHours ?? (value as AuTimesheet).hours;
}
export function employeePhone(value: PayrollEmployee): string | undefined {
  return (value as NzEmployee).phoneNumber ?? (value as AuEmployee).phone;
}
export function employeeEngagement(value: PayrollEmployee): string | undefined {
  return (value as NzEmployee).engagementType;
}
