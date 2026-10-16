import type { StationTimetable, SubwayDirection, SubwayStation } from "../subway.types";

export type TimetableSource = StationTimetable["source"];

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
  stationId: string;
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

export interface StationSchedule {
  station: SubwayStation;
  serviceDate: string;
  dayType: DayType;
  lineRoutes: LineRoutes;
  trains: readonly ScheduledTrain[];
}
