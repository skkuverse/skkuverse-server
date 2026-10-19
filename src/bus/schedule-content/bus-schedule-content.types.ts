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

/** WHY: one snapshot of every dataset a timetable folds in; a cache built from it is keyed by `revisionKey`. */
export interface ScheduleContent {
  revisionKey: string;
  restDays: RestDays;
  noticesOf(serviceId: string): readonly StoredServiceNotice[];
  suspendOf(serviceId: string): SuspendDates | null;
}

export interface BusServiceReference {
  dataset: "busServices";
  id: string;
  path: Array<string | number>;
}

export interface RestDays {
  exact: Map<string, string>;
  annual: Map<string, string>;
}

export interface RestDaysRevision {
  revision: number;
  restDays: RestDays;
}
