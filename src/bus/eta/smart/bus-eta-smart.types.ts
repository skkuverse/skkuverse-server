import type { SmartSchedule } from "../../schedule/bus-schedule.wire";
import type { SequenceStop } from "../../stops/bus-stops.types";
import type { ShuttleEtaDoc } from "../bus-eta.document";

export type EtaSource = "frozen" | "live" | "predicted";

export interface ServedEstimate {
  offsetsSec: number[];
  source: EtaSource;
  updatedAt: Date;
}

export type EstimatePick = (docs: readonly ShuttleEtaDoc[], now: Date) => Map<string, ServedEstimate>;

export interface EstimateInputs {
  routeTypes: readonly string[];
  sequences: Readonly<Record<string, readonly SequenceStop[]>>;
  estimates: ReadonlyMap<string, ServedEstimate>;
  /** WHY: each run's latest estimate, served or not, which only the stop page's listing time reads (ADR 0019, D12). */
  latestEstimates?: ReadonlyMap<string, ServedEstimate>;
}

/** WHY: a run at one stop of its sequence: what the smart view shows there, and its latest estimate there, if any. */
export interface RunStopTime {
  shownAt: Date | null;
  isEstimated: boolean;
  latestEstimateAt: Date | null;
}

/** WHY: one run of the stored timetable with its stop times parsed once (ADR 0019, D12); `estimate` is the one served. */
export interface ShuttleRun {
  runId: string;
  routeType: string;
  date: string;
  departureAt: Date;
  isLastOfDay: boolean;
  stopTimes: RunStopTime[];
  estimate: Pick<ServedEstimate, "source" | "updatedAt"> | null;
}

/** WHY: the shown week, or it and the next, which a stop page reads only when the shown week lists too few runs (ADR 0019, D12). */
export interface RunWindow {
  from: Date;
  weekCount: 1 | 2;
}

export interface RunList {
  status: SmartSchedule["status"];
  runs: ShuttleRun[];
}
