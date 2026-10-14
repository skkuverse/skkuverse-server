import type { ServiceNotice } from "../bus.types";
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

// CONTRACT(scripts): written by scripts/seed-eskara.js and scripts/seed-vacation-2026.js.
export interface BusOverrideDoc {
  serviceId: string;
  date: string;
  type: string;
  entries: ScheduleEntry[];
  label?: string | null;
  notices: ServiceNotice[];
}
