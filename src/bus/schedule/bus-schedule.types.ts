import type { z } from "zod";
import type { ServiceConfigEntry } from "../bus.types";
import type { ScheduleContent } from "../schedule-content/bus-schedule-content.types";
import type { BusOverrideDoc, BusScheduleDoc } from "./bus-schedule.document";
import type { weekQuery } from "./bus-schedule.schema";
import type { ScheduleNotice } from "./bus-schedule.wire";

export type SuspendWindow = { invalid: true } | { invalid: false; resumeDate: string | null };

export interface PickedPattern<T> {
  pattern: T | undefined;
  conflicting: T[] | null;
}

export interface DaySources {
  override: BusOverrideDoc | undefined;
  restDayLabel: string | null;
  pattern: BusScheduleDoc | undefined;
  serviceNotices: readonly ScheduleNotice[];
  config: ServiceConfigEntry;
}

/** WHY: one week of one service, resolved over one snapshot of the schedule content. */
export interface WeekRequest {
  serviceId: string;
  from: string;
  serviceConfig: ServiceConfigEntry;
  content: ScheduleContent;
}

export type WeekQuery = z.output<typeof weekQuery>;
