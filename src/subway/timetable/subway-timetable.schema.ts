import { z } from "zod";
import type { Timetable } from "./subway-timetable.types";

const secondsOfServiceDay = z.number().int().nonnegative().nullable();

const timetableStop = z.object({ station: z.string().min(1), arr: secondsOfServiceDay, dep: secondsOfServiceDay });

const timetableTrain = z.object({
  trainNo: z.string().regex(/^\d{4}$/),
  direction: z.enum(["up", "down"]),
  destination: z.string().min(1),
  express: z.boolean(),
  stops: z.array(timetableStop).min(1),
});

export const timetableFile = z.object({
  source: z.object({ kind: z.string().min(1), ref: z.string().min(1), revision: z.string().min(1) }),
  operator: z.string().min(1),
  line: z.string().min(1),
  dayType: z.enum(["weekday", "saturday", "holiday"]),
  stations: z.array(z.string().min(1)).min(1),
  trains: z.array(timetableTrain),
}) satisfies z.ZodType<Timetable>;
