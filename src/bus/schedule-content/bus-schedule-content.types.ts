import type { CalendarDay } from "../../calendar/calendar.types";
import type { ServiceContent } from "./bus-schedule-content.schema";

export interface ServiceNoticesRevision {
  revision: number;
  services: Record<string, ServiceContent>;
}

export interface DatasetLogEvents {
  dataset: string;
  missing: string;
  invalid: string;
}

export type StoredServiceNotice = ServiceContent["notices"][number];

export type SuspendDates = NonNullable<ServiceContent["suspend"]>;

/** WHY: one snapshot of every dataset a timetable folds in, and the calendar it asks per date; a cache built from it
 * is keyed by `revisionKey`, which folds in the calendar's. */
export interface ScheduleContent {
  revisionKey: string;
  dayOf(dateStr: string): Promise<CalendarDay>;
  noticesOf(serviceId: string): readonly StoredServiceNotice[];
  suspendOf(serviceId: string): SuspendDates | null;
}

export interface BusServiceReference {
  dataset: "busServices";
  id: string;
  path: Array<string | number>;
}

