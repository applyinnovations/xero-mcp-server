import { z } from "zod";
import { TenantXeroClient, xeroClient } from "../../clients/xero-client.js";
import { getClientHeaders } from "../../helpers/get-client-headers.js";
import { PayrollAuTimesheetsV2Api } from "./timesheets-v2.js";

/** Australian contracts only: SDK AU 1.0 Employees/PayItems and AU 2.0 Timesheets. */
export class AuPayrollClient {
  readonly timesheets: PayrollAuTimesheetsV2Api;
  constructor(private readonly tenant: TenantXeroClient) {
    if (tenant.payrollRegion !== "AU")
      throw new Error("AU payroll client requires the AU module");
    this.timesheets = new PayrollAuTimesheetsV2Api((method, path) =>
      tenant.authorizePayrollRequest("AU", method, path),
    );
  }
  async employees() {
    await this.tenant.authenticate();
    return (
      (
        await this.tenant.payrollAUApi.getEmployees(
          this.tenant.tenantId,
          undefined,
          undefined,
          undefined,
          undefined,
          getClientHeaders(),
        )
      ).body.employees ?? []
    );
  }
  async leaveTypes() {
    await this.tenant.authenticate();
    return (
      (
        await this.tenant.payrollAUApi.getPayItems(
          this.tenant.tenantId,
          undefined,
          undefined,
          undefined,
          undefined,
          getClientHeaders(),
        )
      ).body.payItems?.leaveTypes ?? []
    );
  }
  async leaveBalances(employeeId: string) {
    z.string().uuid().parse(employeeId);
    await this.tenant.authenticate();
    const employees = (
      await this.tenant.payrollAUApi.getEmployee(
        this.tenant.tenantId,
        employeeId,
        getClientHeaders(),
      )
    ).body.employees;
    const employee = employees?.find((item) => item.employeeID === employeeId);
    if (!employee)
      throw new Error(
        "AU employee response does not contain the requested employee",
      );
    return employee.leaveBalances ?? [];
  }
}
export const auPayrollClient = () => new AuPayrollClient(xeroClient);
