import axios from "axios";
import { z } from "zod";
import { auTimesheetSchema, auTimesheetLineSchema } from "./schemas.js";

// Xero's official AU v2 OpenAPI, reviewed blob e3a31a402e0011ba7b0e2482617709d8389df570:
// https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-payroll-au-v2.yaml
// xero-node 13.3 (and published 20.0) exposes only AU v1. Keep this narrow
// AU-specific contract separate from both that SDK and the NZ v2 API.
const lineReceipt = z
  .object({
    timesheetLineID: z.string().uuid(),
    date: z.string(),
    earningsRateID: z.string().uuid(),
    numberOfUnits: z.number(),
    trackingItemID: z.string().uuid().nullable().optional(),
  })
  .passthrough();
const timesheetReceipt = z
  .object({
    timesheetID: z.string().uuid(),
    payrollCalendarID: z.string().uuid(),
    employeeID: z.string().uuid(),
    startDate: z.string(),
    endDate: z.string(),
    status: z.enum(["Draft", "Approved", "Completed"]),
    totalHours: z.number().optional(),
    updatedDateUTC: z.string().nullable().optional(),
    timesheetLines: z.array(lineReceipt).optional(),
  })
  .passthrough();
const envelope = z
  .object({ problem: z.null().optional(), httpStatusCode: z.literal("OK") })
  .passthrough();
export type AuV2Timesheet = z.infer<typeof timesheetReceipt>;
export type AuV2TimesheetLine = z.infer<typeof lineReceipt>;
export type AuV2Authorization = (
  method: string,
  path: string,
) => Promise<Record<string, string>>;
const AU_V2_BASE_PATH = "https://api.xero.com/payroll.xro/2.0";

export class PayrollAuTimesheetsV2Api {
  get basePath(): string {
    return AU_V2_BASE_PATH;
  }
  constructor(private readonly authorize: AuV2Authorization) {}

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const headers = await this.authorize(method, path);
    const response = await axios.request({
      method,
      url: `${AU_V2_BASE_PATH}${path}`,
      data: body,
      headers: {
        ...headers,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 10_000,
      maxRedirects: 0,
    });
    // A successful HTTP response still needs a non-problem v2 envelope. Never
    // deserialize v1 arrays or fabricate a successful mutation from a missing receipt.
    if (!envelope.safeParse(response.data).success)
      throw new Error(
        "Xero AU Timesheets 2.0 returned an invalid or rejected response",
      );
    return response.data;
  }

  private async timesheet(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<AuV2Timesheet> {
    const receipt = z
      .object({ timesheet: timesheetReceipt })
      .safeParse(await this.request(method, path, body));
    if (!receipt.success)
      throw new Error(
        "Xero AU Timesheets 2.0 did not return a valid timesheet receipt",
      );
    return receipt.data.timesheet;
  }

  async getTimesheets(): Promise<AuV2Timesheet[]> {
    const receipt = z
      .object({ timesheets: z.array(timesheetReceipt) })
      .safeParse(await this.request("GET", "/Timesheets"));
    if (!receipt.success)
      throw new Error(
        "Xero AU Timesheets 2.0 did not return a valid timesheets response",
      );
    return receipt.data.timesheets;
  }
  getTimesheet(id: string): Promise<AuV2Timesheet> {
    return this.selectedTimesheet("GET", id);
  }
  async createTimesheet(input: unknown): Promise<AuV2Timesheet> {
    const payload = auTimesheetSchema.parse(input);
    const value = await this.timesheet("POST", "/Timesheets", payload);
    if (
      value.employeeID !== payload.employeeID ||
      value.payrollCalendarID !== payload.payrollCalendarID
    )
      throw new Error(
        "Xero AU Timesheets 2.0 returned a different employee or payroll calendar",
      );
    return value;
  }
  approveTimesheet(id: string): Promise<AuV2Timesheet> {
    return this.selectedTimesheet("POST", id, "/Approve");
  }
  revertTimesheet(id: string): Promise<AuV2Timesheet> {
    return this.selectedTimesheet("POST", id, "/RevertToDraft");
  }
  private async selectedTimesheet(
    method: string,
    id: string,
    suffix = "",
  ): Promise<AuV2Timesheet> {
    const value = await this.timesheet(
      method,
      `/Timesheets/${z.string().uuid().parse(id)}${suffix}`,
    );
    if (value.timesheetID !== id)
      throw new Error("Xero AU Timesheets 2.0 returned a different timesheet");
    return value;
  }
  async deleteTimesheet(id: string): Promise<void> {
    await this.request("DELETE", `/Timesheets/${z.string().uuid().parse(id)}`);
  }
  async createTimesheetLine(
    id: string,
    input: unknown,
  ): Promise<AuV2TimesheetLine> {
    return this.line(
      "POST",
      `/Timesheets/${z.string().uuid().parse(id)}/Lines`,
      input,
    );
  }
  async updateTimesheetLine(
    id: string,
    lineId: string,
    input: unknown,
  ): Promise<AuV2TimesheetLine> {
    const value = await this.line(
      "PUT",
      `/Timesheets/${z.string().uuid().parse(id)}/Lines/${z.string().uuid().parse(lineId)}`,
      input,
    );
    if (value.timesheetLineID !== lineId)
      throw new Error(
        "Xero AU Timesheets 2.0 returned a different timesheet line",
      );
    return value;
  }
  private async line(
    method: string,
    path: string,
    input: unknown,
  ): Promise<AuV2TimesheetLine> {
    const receipt = z
      .object({ timesheetLine: lineReceipt })
      .safeParse(
        await this.request(method, path, auTimesheetLineSchema.parse(input)),
      );
    if (!receipt.success)
      throw new Error(
        "Xero AU Timesheets 2.0 did not return a valid timesheet line receipt",
      );
    return receipt.data.timesheetLine;
  }
}
