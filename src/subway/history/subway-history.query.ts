import type { Document, Filter, UpdateFilter } from "mongodb";
import type { SubwayPredictionDoc } from "./subway-history.document";
import type { ObservedArrival } from "./subway-history.types";

const SECOND_MS = 1000;

export function toObservedArrivalFilter(arrival: ObservedArrival): Filter<SubwayPredictionDoc> {
  return { serviceDate: arrival.serviceDate, trainNo: arrival.trainNo, stationId: arrival.stationId, status: "open" };
}

// WHY: the pipeline form of toErrorSec (subway-history.rules.ts): each record's own predicted instant minus the one
// observed instant, so one update resolves every horizon of the train.
export function toObservedArrivalUpdate(arrival: ObservedArrival, resolvedAt: Date): Document[] {
  const { observedAt, observedState } = arrival;
  const errorSec = { $divide: [{ $subtract: ["$predictedAt", observedAt] }, SECOND_MS] };
  return [{ $set: { status: "resolved", observedAt, observedState, resolvedAt, errorSec } }];
}

export function toUnresolvedFilter(cutoff: Date): Filter<SubwayPredictionDoc> {
  return { status: "open", predictedAt: { $lt: cutoff } };
}

export function toUnresolvedUpdate(markedAt: Date): UpdateFilter<SubwayPredictionDoc> {
  return { $set: { status: "unresolved", resolvedAt: markedAt } };
}
