import { APPROACH_LEAD_MS } from "../subway.constants";
import type { TrainEvent } from "../subway.types";
import { PREDICTION_HORIZONS_MIN, UNRESOLVED_AFTER_MS } from "./subway-history.constants";
import type { SubwayPredictionDoc } from "./subway-history.document";
import type { ObservedArrival, PredictionMade } from "./subway-history.types";

const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

// WHY: a train first seen inside a horizon has no prediction made at that horizon, so it gets no record there
// (the spec's "Horizon already passed").
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

export function toPredictionDoc(made: PredictionMade, observed: ObservedArrival | undefined): SubwayPredictionDoc {
  const { serviceDate, stationId, direction, horizonMin, train, madeAt } = made;
  const prediction = { serviceDate, trainNo: train.trainNo, stationId, horizonMin, direction, source: train.source, predictedAt: train.arrivalAt, madeAt };
  if (!observed) return { ...prediction, status: "open", observedAt: null, observedState: null, resolvedAt: null, errorSec: null };
  const { observedAt, observedState } = observed;
  return { ...prediction, status: "resolved", observedAt, observedState, resolvedAt: madeAt, errorSec: toErrorSec(train.arrivalAt, observedAt) };
}
