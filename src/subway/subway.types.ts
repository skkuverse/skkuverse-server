import type { z } from "zod";
import type { SupportedLang } from "../infra/types";
import type { subwayRegistryFile } from "./subway.schema";

export type LocalizedName = Readonly<Record<SupportedLang, string>>;

export type SubwayDirection = "up" | "down";

export type SubwayRegistry = z.output<typeof subwayRegistryFile>;
export type SubwayLine = SubwayRegistry["lines"][number];
export type SubwayStation = SubwayRegistry["stations"][number];
export type SubwayPlatform = SubwayStation["platforms"][number];
export type SubwayNeighbor = SubwayRegistry["neighbors"][string];
export type PlatformDirection = SubwayPlatform["directions"]["up"];
export type PlatformTimetable = SubwayPlatform["timetable"];
export type TrainNumbering = SubwayLine["seoul"]["trainNumbers"];

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
