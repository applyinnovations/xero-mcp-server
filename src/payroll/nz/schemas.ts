import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const nzTimesheetLineSchema = z
  .object({ earningsRateID: z.string(), numberOfUnits: z.number(), date })
  .strict();
export const nzTimesheetShape = {
  employeeID: z.string(),
  startDate: date,
  endDate: date,
  payrollCalendarID: z.string(),
  timesheetLines: z
    .array(
      z
        .object({ earningsRateID: z.string(), numberOfUnits: z.number(), date })
        .strict(),
    )
    .optional(),
};
export const nzTimesheetSchema = z.object(nzTimesheetShape).strict();
