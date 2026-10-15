import { z } from "zod";
import { isRecord } from "../../shared/object.util";
import type { ServiceNotice } from "../bus.types";
import type { BusOverrideDoc, BusScheduleDoc } from "./bus-schedule.document";
import type { ScheduleEntry } from "./bus-schedule.wire";

// WHY: entries and notices are served as stored, so they are checked, not rebuilt: a rebuilt object would
// reorder its keys and move every week's ETag.
const storedEntry = z.custom<ScheduleEntry>(isRecord);
const storedNotice = z.custom<ServiceNotice>(isRecord);

export const busScheduleDoc = z.object({
  serviceId: z.string(),
  patternId: z.string(),
  days: z.array(z.number()),
  entries: z.array(storedEntry),
  effectiveFrom: z.string().optional(),
  effectiveUntil: z.string().optional(),
}) satisfies z.ZodType<BusScheduleDoc>;

const overrideFields = {
  serviceId: z.string(),
  date: z.string(),
  label: z.string().nullish(),
  notices: z.array(storedNotice),
};

// WHY: only a replace override serves entries, and a type that is neither is not a closure. The collection
// holds the same shape as its validator (scripts/lib/bus-overrides-validator.js), pinned to this schema by
// __tests__/nest/bus/bus-overrides-validator.test.ts.
export const busOverrideDoc = z.discriminatedUnion("type", [
  z.object({ ...overrideFields, type: z.literal("replace"), entries: z.array(storedEntry) }),
  z.object({ ...overrideFields, type: z.literal("noService"), entries: z.array(storedEntry).optional() }),
]) satisfies z.ZodType<BusOverrideDoc>;

const EXACT_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ANNUAL_KEY = /^\d{2}-\d{2}$/;

/** WHY: keys starting with "_" document the file and are skipped; any other key must be a date or a month-day. */
export const restDaysFile = z.record(z.string(), z.unknown()).superRefine((raw, ctx) => {
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    if (typeof value !== "string" || value === "") ctx.addIssue({ code: "custom", path: [], message: `"${key}" needs a non-empty string label` });
    else if (!EXACT_KEY.test(key) && !ANNUAL_KEY.test(key)) ctx.addIssue({ code: "custom", path: [], message: `"${key}" is neither YYYY-MM-DD nor MM-DD` });
  }
});

const WEEK_START = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_START_MESSAGE = "from must be YYYY-MM-DD";

// QUIRK(express): `?from=A&from=B` arrives as an array, which the string check refuses with the same message.
export const weekQuery = z.object({
  from: z.string({ error: WEEK_START_MESSAGE }).regex(WEEK_START, { error: WEEK_START_MESSAGE }).optional(),
});
