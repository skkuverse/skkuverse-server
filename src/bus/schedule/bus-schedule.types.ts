import type { z } from "zod";
import type { ServiceConfigEntry } from "../bus.types";
import type { BusOverrideDoc, BusScheduleDoc } from "./bus-schedule.document";
import type { weekQuery } from "./bus-schedule.schema";
import type { ScheduleNotice } from "./bus-schedule.wire";

export interface RestDays {
  exact: Map<string, string>;
  annual: Map<string, string>;
}

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

export type WeekQuery = z.output<typeof weekQuery>;
