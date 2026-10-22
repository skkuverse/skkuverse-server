import { APPROACH_LEAD_MS } from "../subway.constants";
import type { TrainEvent, TrainState } from "../subway.types";
import { PREDICTION_HORIZONS_MIN, UNRESOLVED_AFTER_MS } from "./subway-history.constants";
import type { SubwayPredictionDoc } from "./subway-history.document";
import type { ObservedArrival, PredictionMade } from "./subway-history.types";

const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

// WHY: a train first seen inside a horizon has no prediction made at that horizon, so it gets no record there.
export function toCrossedHorizons(previousLeadMs: number | undefined, leadMs: number): number[] {
  if (previousLeadMs === undefined) return [];
  return PREDICTION_HORIZONS_MIN.filter((horizonMin) => previousLeadMs > horizonMin * MINUTE_MS && leadMs <= horizonMin * MINUTE_MS);
}

export function toObservedArrivalAt(event: Pick<TrainEvent, "state" | "stateChangedAt">): Date | null {
  if (event.state === "departed") return null;
  const leadMs = event.state === "approaching" ? APPROACH_LEAD_MS : 0;
  return new Date(event.stateChangedAt.getTime() + leadMs);
}

export function toErrorSec(predictedAt: Date, observedAt: Date): number {
  return (predictedAt.getTime() - observedAt.getTime()) / SECOND_MS;
}

export function toUnresolvedCutoff(now: Date): Date {
  return new Date(now.getTime() - UNRESOLVED_AFTER_MS);
}

export function toPredictionDoc(made: PredictionMade): SubwayPredictionDoc {
  const { serviceDate, platformId: stationId, direction, horizonMin, train, madeAt } = made;
  const prediction = { serviceDate, trainNo: train.trainNo, stationId, horizonMin, direction, source: train.source, predictedAt: train.arrivalAt, madeAt };
  return { ...prediction, status: "open", observedAt: null, observedState: null, resolvedAt: null, errorSec: null };
}

// WHY: an arrived row is the arrival itself; an approaching row 30 s on stands in for it only until one is seen.
// EVIDENCE: at KR-1-0153 on 2026-10-17 the arrived row came about 10 s after the approaching row's 30 s.
const REPLACEABLE_OBSERVED_STATES: Readonly<Record<TrainState, readonly (TrainState | null)[]>> = {
  approaching: [null],
  arrived: [null, "approaching"],
  departed: [],
};

export function toReplaceableObservedStates(observedState: TrainState): readonly (TrainState | null)[] {
  return REPLACEABLE_OBSERVED_STATES[observedState];
}

// WHY: a record made at or after the tick that first saw a row was predicted from that row (F6), so only a row first
// seen after it may resolve it; the row's own time may be earlier, as upstream lag delivers it late.
export function isResolvableBy(
  record: Pick<SubwayPredictionDoc, "status" | "observedState" | "madeAt" | "predictedAt">,
  arrival: Pick<ObservedArrival, "observedState">,
  seenAt: Date,
): boolean {
  const isMadeBeforeSeen = record.madeAt.getTime() < seenAt.getTime();
  const isWithinUnresolvedWindow = record.predictedAt.getTime() >= toUnresolvedCutoff(seenAt).getTime();
  const isReplaceable = toReplaceableObservedStates(arrival.observedState).includes(record.observedState);
  return record.status !== "unresolved" && isMadeBeforeSeen && isWithinUnresolvedWindow && isReplaceable;
}
