import { z } from "zod";

export const scheduleNotice = z.object({
  style: z.string(),
  text: z.string(),
  /** WHY: "service" for the service's own notice, "override" for one a date override carries. */
  source: z.string().optional(),
});

/** WHY: a timetable entry as the timetable scripts store it; served as stored. */
export const scheduleEntry = z.object({
  index: z.int().optional(),
  time: z.string().optional(),
  routeType: z.string().optional(),
  busCount: z.int().optional(),
  notes: z.string().nullable().optional(),
  stopTimes: z.array(z.string().nullable()).optional(),
  eta: z.object({ source: z.string(), updatedAt: z.iso.datetime() }).optional(),
});

export const scheduleDay = z.object({
  date: z.string(),
  dayOfWeek: z.int(),
  display: z.string(),
  label: z.string().nullable().optional(),
  notices: z.array(scheduleNotice),
  schedule: z.array(scheduleEntry),
});

/** WHY: the deprecated week view; installed builds before the smart view still call it. */
export const scheduleWeek = z.object({
  serviceId: z.string(),
  requestedFrom: z.string().nullable(),
  from: z.string(),
  days: z.array(scheduleDay),
});

/** CONTRACT(skkuverse-app): parsed by skkuverse-app/packages/shared/src/bus/parser.ts (parseSmartSchedule). */
export const smartSchedule = z.object({
  serviceId: z.string(),
  status: z.enum(["active", "suspended", "noData"]),
  resumeDate: z.string().optional(),
  from: z.string().nullable(),
  selectedDate: z.string().nullable(),
  days: z.array(scheduleDay),
  /** WHY: the localized reason, on a status other than active. */
  message: z.string().optional(),
});

export type ScheduleNotice = z.input<typeof scheduleNotice>;
export type ScheduleEntry = z.input<typeof scheduleEntry>;
export type ScheduleDay = z.input<typeof scheduleDay>;
export type ScheduleWeek = z.input<typeof scheduleWeek>;
export type SmartSchedule = z.input<typeof smartSchedule>;
