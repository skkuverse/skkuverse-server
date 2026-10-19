import { z } from "zod";
import { SERVICE_NOTICE_STYLES } from "./bus-schedule-content.constants";
import type { StoredRestDays, StoredServiceNotices } from "./bus-schedule-content.document";
import { isCalendarDate, isRestDayKey, toRestDays } from "./bus-schedule-content.rules";

const calendarDate = z.string().refine(isCalendarDate, { error: "must be a calendar date, YYYY-MM-DD" });

const serviceNotice = z.strictObject({ style: z.enum(SERVICE_NOTICE_STYLES), text: z.string().min(1) });

// WHY: dates are YYYY-MM-DD, so string order is date order; both days are inside the suspension. An invalid date
// is already an issue at its own path, so the order is checked only between two dates.
const suspendWindow = z
  .strictObject({ from: calendarDate, until: calendarDate })
  .refine(({ from, until }) => !isCalendarDate(from) || !isCalendarDate(until) || from <= until, { path: ["until"], error: "until must not be before from" });

const serviceContent = z.strictObject({ notices: z.array(serviceNotice), suspend: suspendWindow.nullable() });

export const busServiceNoticesDataset = z.strictObject({ services: z.record(z.string(), serviceContent) });

export type BusServiceNotices = z.output<typeof busServiceNoticesDataset>;

export type ServiceContent = z.output<typeof serviceContent>;

export const storedServiceNotices = z.object({ revision: z.int().positive(), data: busServiceNoticesDataset }) satisfies z.ZodType<StoredServiceNotices>;

export const skkuRestDaysDataset = z
  .record(z.string(), z.string().min(1))
  .superRefine((labelByKey, ctx) => {
    for (const key of Object.keys(labelByKey)) {
      if (!isRestDayKey(key)) ctx.addIssue({ code: "custom", path: [key], message: "must be a calendar MM-DD or a calendar YYYY-MM-DD from 1900 to 2999" });
    }
  })
  .transform(toRestDays);

export const storedRestDays = z.object({ revision: z.int().positive(), data: skkuRestDaysDataset }) satisfies z.ZodType<StoredRestDays>;
