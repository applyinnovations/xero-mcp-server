import { Timesheet } from "xero-node/dist/gen/model/payroll-nz/timesheet.js";
import { EmployeeLeaveBalance } from "./types.js";
import { EmployeeLeaveType } from "./types.js";
import { EmployeeLeave } from "./types.js";
import { Employee } from "./types.js";
import { LeavePeriod } from "./types.js";
import { LeaveType } from "./types.js";
import { TimesheetLine } from "xero-node/dist/gen/model/payroll-nz/timesheetLine.js";
import { TenantXeroClient, xeroClient } from "../../clients/xero-client.js";
import { getClientHeaders } from "../../helpers/get-client-headers.js";
import { nzTimesheetSchema, nzTimesheetLineSchema } from "./schemas.js";
interface FetchLeavePeriodParams {
  employeeId?: string;
  startDate?: string;
  endDate?: string;
}
interface FetchEmployeeLeaveParams {
  employeeId?: string;
}

/** New Zealand SDK contracts only. No Australian DTOs or routes. */
export class NzPayrollClient {
  constructor(private readonly tenant: TenantXeroClient) {
    if (tenant.payrollRegion !== "NZ")
      throw new Error("NZ payroll client requires the NZ module");
  }
  async approveTimesheet(timesheetID: string): Promise<Timesheet | null> {
    await this.tenant.authenticate();

    // Call the approveTimesheet endpoint from the PayrollNZApi
    const approvedTimesheet = await this.tenant.payrollNZApi.approveTimesheet(
      this.tenant.tenantId,
      timesheetID,
    );

    return approvedTimesheet.body.timesheet ?? null;
  }

  async createTimesheet(timesheet: Timesheet): Promise<Timesheet | null> {
    timesheet = nzTimesheetSchema.parse(timesheet);
    await this.tenant.authenticate();

    // Call the createTimesheet endpoint from the PayrollNZApi
    const createdTimesheet = await this.tenant.payrollNZApi.createTimesheet(
      this.tenant.tenantId,
      timesheet,
    );

    return createdTimesheet.body.timesheet ?? null;
  }

  async deleteTimesheet(timesheetID: string): Promise<boolean> {
    await this.tenant.authenticate();

    // Call the deleteTimesheet endpoint from the PayrollNZApi
    await this.tenant.payrollNZApi.deleteTimesheet(
      this.tenant.tenantId,
      timesheetID,
    );

    return true;
  }

  async getTimesheet(timesheetID: string): Promise<Timesheet | null> {
    await this.tenant.authenticate();

    // Call the Timesheet endpoint from the PayrollNZApi
    const timesheet = await this.tenant.payrollNZApi.getTimesheet(
      this.tenant.tenantId,
      timesheetID,
    );

    return timesheet.body.timesheet ?? null;
  }

  async fetchEmployeeLeaveBalances(
    employeeId: string,
  ): Promise<EmployeeLeaveBalance[] | null> {
    await this.tenant.authenticate();

    if (!employeeId) {
      throw new Error(
        "Employee ID is required to fetch employee leave balances",
      );
    }

    const response = await this.tenant.payrollNZApi.getEmployeeLeaveBalances(
      this.tenant.tenantId,
      employeeId,
      getClientHeaders(),
    );

    return response.body.leaveBalances ?? null;
  }

  async fetchEmployeeLeaveTypes(
    employeeId: string,
  ): Promise<EmployeeLeaveType[] | null> {
    await this.tenant.authenticate();

    if (!employeeId) {
      throw new Error("Employee ID is required to fetch employee leave types");
    }

    const response = await this.tenant.payrollNZApi.getEmployeeLeaveTypes(
      this.tenant.tenantId,
      employeeId,
      getClientHeaders(),
    );

    return response.body.leaveTypes ?? null;
  }

  async fetchEmployeeLeave({
    employeeId,
  }: FetchEmployeeLeaveParams): Promise<EmployeeLeave[] | null> {
    await this.tenant.authenticate();

    if (!employeeId) {
      throw new Error("Employee ID is required to fetch employee leave");
    }

    const response = await this.tenant.payrollNZApi.getEmployeeLeaves(
      this.tenant.tenantId,
      employeeId,
      {
        headers: getClientHeaders().headers,
      },
    );

    return response.body.leave ?? null;
  }

  async getPayrollEmployees(): Promise<Employee[]> {
    await this.tenant.authenticate();

    // Call the Employees endpoint from the PayrollNZApi
    const employees = await this.tenant.payrollNZApi.getEmployees(
      this.tenant.tenantId,
      undefined, // page
      undefined, // pageSize
      getClientHeaders(),
    );

    return employees.body.employees ?? [];
  }

  async fetchLeavePeriods({
    employeeId,
    startDate,
    endDate,
  }: FetchLeavePeriodParams): Promise<LeavePeriod[] | null> {
    await this.tenant.authenticate();

    if (!employeeId) {
      throw new Error("Employee ID is required to fetch leave periods");
    } // After reviewing the SDK documentation, it appears this API call requires different parameters
    // Use parameters that match the SDK's expectations
    const response = await this.tenant.payrollNZApi.getEmployeeLeavePeriods(
      this.tenant.tenantId,
      employeeId,
      startDate,
      endDate,
    );

    return response.body.periods ?? null;
  }

  async fetchLeaveTypes(): Promise<LeaveType[] | null> {
    await this.tenant.authenticate();

    const response = await this.tenant.payrollNZApi.getLeaveTypes(
      this.tenant.tenantId,
      undefined, // page
      undefined, // pageSize
      getClientHeaders(),
    );

    return response.body.leaveTypes ?? null;
  }

  async getTimesheets(): Promise<Timesheet[]> {
    await this.tenant.authenticate();

    // Call the Timesheets endpoint from the PayrollNZApi
    const timesheets = await this.tenant.payrollNZApi.getTimesheets(
      this.tenant.tenantId,
      undefined, // page
      undefined, // filter
    );

    return timesheets.body.timesheets ?? [];
  }

  async revertTimesheet(timesheetID: string): Promise<Timesheet | null> {
    await this.tenant.authenticate();

    // Call the revertTimesheet endpoint from the PayrollNZApi
    const revertedTimesheet = await this.tenant.payrollNZApi.revertTimesheet(
      this.tenant.tenantId,
      timesheetID,
    );

    return revertedTimesheet.body.timesheet ?? null;
  }

  async addTimesheetLine(
    timesheetID: string,
    timesheetLine: TimesheetLine,
  ): Promise<TimesheetLine | null> {
    timesheetLine = nzTimesheetLineSchema.parse(timesheetLine);
    await this.tenant.authenticate();

    // Call the createTimesheetLine endpoint from the PayrollNZApi
    const createdLine = await this.tenant.payrollNZApi.createTimesheetLine(
      this.tenant.tenantId,
      timesheetID,
      timesheetLine,
    );

    return createdLine.body.timesheetLine ?? null;
  }

  async updateTimesheetLine(
    timesheetID: string,
    timesheetLineID: string,
    timesheetLine: TimesheetLine,
  ): Promise<TimesheetLine | null> {
    timesheetLine = nzTimesheetLineSchema.parse(timesheetLine);
    await this.tenant.authenticate();

    // Call the updateTimesheetLine endpoint from the PayrollNZApi
    const updatedLine = await this.tenant.payrollNZApi.updateTimesheetLine(
      this.tenant.tenantId,
      timesheetID,
      timesheetLineID,
      timesheetLine,
    );

    return updatedLine.body.timesheetLine ?? null;
  }
}
export const nzPayrollClient = () => new NzPayrollClient(xeroClient);
