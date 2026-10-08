import { z } from "zod";
import type { PayrollRegion } from "./region.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const common = { employeeID: z.string(), startDate: date, endDate: date };
export const nzTimesheetShape = {
  ...common, payrollCalendarID: z.string(),
  timesheetLines: z.array(z.object({ earningsRateID: z.string(), numberOfUnits: z.number(), date }).strict()).optional(),
};
export const auTimesheetShape = {
  ...common,
  timesheetLines: z.array(z.object({
    earningsRateID: z.string(), trackingItemID: z.string().optional(),
    numberOfUnits: z.array(z.number()).describe("One entry per day, in order from startDate through endDate, including zero-unit days"),
  }).strict()).optional(),
};
export const nzTimesheetSchema = z.object(nzTimesheetShape).strict();
export const auTimesheetSchema = z.object(auTimesheetShape).strict().superRefine((value, ctx) => {
  const start = Date.parse(value.startDate), end = Date.parse(value.endDate);
  const days = (end - start) / 86_400_000 + 1;
  if (!Number.isInteger(days) || days < 1 ||
      new Date(start).toISOString().slice(0, 10) !== value.startDate ||
      new Date(end).toISOString().slice(0, 10) !== value.endDate) {
    ctx.addIssue({ code: "custom", message: "AU timesheet requires a valid inclusive date range" });
    return;
  }
  value.timesheetLines?.forEach((line, index) => {
    if (line.numberOfUnits.length !== days) ctx.addIssue({ code: "custom", path: ["timesheetLines", index, "numberOfUnits"], message: "AU numberOfUnits must contain one entry per day in the timesheet period" });
  });
});
export function timesheetShape(region: PayrollRegion) {
  return region === "AU" ? auTimesheetShape : nzTimesheetShape;
}
