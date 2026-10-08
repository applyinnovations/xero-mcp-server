import { z } from "zod";
import type { PayrollRegion } from "./region.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const common = { employeeID: z.string(), startDate: date, endDate: date };
export const nzTimesheetShape = {
  ...common, payrollCalendarID: z.string(),
  timesheetLines: z.array(z.object({ earningsRateID: z.string(), numberOfUnits: z.number(), date }).strict()).optional(),
};
export const auTimesheetShape = {
  employeeID: z.string().uuid(), startDate: date, endDate: date, payrollCalendarID: z.string().uuid(),
  timesheetLines: z.array(z.object({
    earningsRateID: z.string().uuid(), trackingItemID: z.string().uuid().optional(),
    numberOfUnits: z.number().finite(), date,
  }).strict()).optional(),
};
export const nzTimesheetSchema = z.object(nzTimesheetShape).strict();
function validDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
export const auTimesheetLineSchema = z.object({
  date: date.refine(validDate, "Use a valid calendar date"), earningsRateID: z.string().uuid(),
  numberOfUnits: z.number().finite(), trackingItemID: z.string().uuid().optional(),
}).strict();
export const auTimesheetSchema = z.object(auTimesheetShape).strict().superRefine((value, ctx) => {
  if (!validDate(value.startDate) || !validDate(value.endDate) || value.startDate > value.endDate) {
    ctx.addIssue({ code: "custom", message: "AU timesheet requires a valid inclusive date range" });
    return;
  }
  value.timesheetLines?.forEach((line, index) => {
    if (!validDate(line.date) || line.date < value.startDate || line.date > value.endDate) ctx.addIssue({ code: "custom", path: ["timesheetLines", index, "date"], message: "AU timesheet line date must be within the timesheet period" });
  });
});
export function timesheetShape(region: PayrollRegion) {
  return region === "AU" ? auTimesheetShape : nzTimesheetShape;
}
