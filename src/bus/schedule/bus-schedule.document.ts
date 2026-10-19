import type { ScheduleEntry } from "./bus-schedule.wire";

// CONTRACT(scripts): written by scripts/set-campus-schedule.js from scripts/data/*-schedule.json.
export interface BusScheduleDoc {
  serviceId: string;
  patternId: string;
  /** WHY: isoWeekday numbers, 1 (Monday) to 7. */
  days: number[];
  entries: ScheduleEntry[];
  /** WHY: inclusive YYYY-MM-DD bounds; a missing bound is open. */
  effectiveFrom?: string;
  effectiveUntil?: string;
}

export interface OverrideNotice {
  style: "info" | "warning" | "error" | string;
  text: string;
}

interface BusOverrideFields {
  serviceId: string;
  date: string;
  label?: string | null;
  notices: OverrideNotice[];
}

// CONTRACT(scripts): written by scripts/seed-eskara.js, scripts/seed-vacation-2026.js and
// scripts/seed-eskara-2026-noservice.js; MongoDB refuses other shapes (scripts/lib/bus-overrides-validator.js).
export type BusOverrideDoc =
  | (BusOverrideFields & { type: "replace"; entries: ScheduleEntry[] })
  | (BusOverrideFields & { type: "noService"; entries?: ScheduleEntry[] });
