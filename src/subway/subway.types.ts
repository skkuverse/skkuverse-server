import type { SupportedLang } from "../infra/types";

export type LocalizedName = Readonly<Record<SupportedLang, string>>;

export type SubwayDirection = "up" | "down";

export interface StationDirection {
  name: LocalizedName;
  upstreamPlatformIds: readonly string[];
  watchedPlatformIds: readonly string[];
  nextPlatformId: string;
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
  platformId: string;
  state: TrainState;
  stateChangedAt: Date;
  destination: string;
}

export interface CountdownRow {
  trainNo: string;
  platformId: string;
  generatedAt: Date;
  remainingSec: number;
}

export interface ProviderObservations {
  source: string;
  events: readonly TrainEvent[];
  countdownRows: readonly CountdownRow[];
}

// WHY: one per upstream, not per provider: each upstream ticks on its own cadence and fails apart (design D7).
export interface SubwayProvider {
  observe(): Promise<ProviderObservations>;
}
