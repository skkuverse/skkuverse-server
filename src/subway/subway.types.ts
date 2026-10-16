import type { SupportedLang } from "../infra/types";

export type LocalizedName = Readonly<Record<SupportedLang, string>>;

export type SubwayDirection = "up" | "down";

export interface StationDirection {
  name: LocalizedName;
  upstreamStationIds: readonly string[];
}

export type StationTimetable = { source: "korail" } | { source: "seoul-station"; stationCode: string };

export interface SeoulStationIds {
  subwayId: string;
  stationName: string;
  trainMapLine: string;
  timetable: StationTimetable;
}

export interface SubwayStation {
  id: string;
  operatorCode: string;
  lineCode: string;
  stationCode: string;
  name: LocalizedName;
  directions: Readonly<Record<SubwayDirection, StationDirection>>;
  seoul: SeoulStationIds;
}

export type TrainState = "approaching" | "arrived" | "departed";

export interface TrainEvent {
  trainNo: string;
  stationId: string;
  state: TrainState;
  stateChangedAt: Date;
}

export interface CountdownRow {
  trainNo: string;
  stationId: string;
  generatedAt: Date;
  remainingSec: number;
}

export interface ProviderObservations {
  events: readonly TrainEvent[];
  countdownRows: readonly CountdownRow[];
}

export interface SubwayProvider {
  observe(): Promise<ProviderObservations>;
}
