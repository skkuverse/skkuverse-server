import type { NetworkPlatform, PlatformTimetable, SubwayDirection } from "../subway.types";
import type { SubwayTimetablesUnavailableError } from "./subway-timetable.error";

export type TimetableSource = PlatformTimetable["source"];

export type DayType = "weekday" | "saturday" | "holiday";

export interface TimetableStop {
  station: string;
  arr: number | null;
  dep: number | null;
}

export interface TimetableTrain {
  trainNo: string;
  direction: SubwayDirection;
  destination: string;
  express: boolean;
  stops: readonly TimetableStop[];
}

export interface Timetable {
  source: { kind: string; ref: string; revision: string };
  operator: string;
  line: string;
  dayType: DayType;
  stations: readonly string[];
  trains: readonly TimetableTrain[];
}

export type LineRoutes = Readonly<Record<SubwayDirection, readonly string[]>>;

export interface ScheduledStop {
  platformId: string;
  arrivalAt: Date | null;
  departureAt: Date | null;
}

export interface ScheduledTrain {
  trainNo: string;
  direction: SubwayDirection;
  destination: string;
  express: boolean;
  stops: readonly ScheduledStop[];
}

export interface PlatformSchedule {
  platform: NetworkPlatform;
  serviceDate: string;
  dayType: DayType;
  lineRoutes: LineRoutes;
  trains: readonly ScheduledTrain[];
}

export interface PlatformSchedules {
  schedules: PlatformSchedule[];
  // WHY: a tick writes the platforms it could schedule, then rejects with this, naming the tables it had none of.
  unavailable: SubwayTimetablesUnavailableError | null;
}

/** WHY: one revision of the stored manifest, each table's part id by key, and when a manifest first named each part. */
export interface ManifestSnapshot {
  revision: number;
  partIdByKey: ReadonlyMap<string, string>;
  firstNamedAtByPartId: ReadonlyMap<string, number>;
}
