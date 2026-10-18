import type { Document, Filter, UpdateFilter } from "mongodb";
import type { SubwayPredictionDoc } from "./subway-history.document";
import { toReplaceableObservedStates, toUnresolvedCutoff } from "./subway-history.rules";
import type { AccuracyRange, ObservedArrival } from "./subway-history.types";

const SECOND_MS = 1000;
const MEDIAN = { numerator: 1, denominator: 2 };
const P90 = { numerator: 9, denominator: 10 };

// WHY: the Mongo form of isResolvableBy (subway-history.rules.ts), `resolvedAt` being the tick that first saw the row.
export function toObservedArrivalFilter(arrival: ObservedArrival, resolvedAt: Date): Filter<SubwayPredictionDoc> {
  const { serviceDate, trainNo, platformId: stationId, observedState } = arrival;
  return {
    serviceDate,
    trainNo,
    stationId,
    status: { $in: ["open", "resolved"] },
    observedState: { $in: [...toReplaceableObservedStates(observedState)] },
    madeAt: { $lt: resolvedAt },
    predictedAt: { $gte: toUnresolvedCutoff(resolvedAt) },
  };
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

// WHY: nearest rank, the element at ceil(p × n) − 1 of the sorted values, so every figure is a recorded error; p is a
// fraction of integers so 0.9 × 30 cannot round past 27.
function toNearestRank(sorted: string, rank: { numerator: number; denominator: number }): Document {
  const size = { $size: sorted };
  const index = { $subtract: [{ $toInt: { $ceil: { $divide: [{ $multiply: [rank.numerator, size] }, rank.denominator] } } }, 1] };
  return { $cond: [{ $eq: [size, 0] }, null, { $arrayElemAt: [sorted, index] }] };
}

export function toAccuracyPipeline(range: AccuracyRange): Document[] {
  const isResolved = { $eq: ["$status", "resolved"] };
  return [
    { $match: { serviceDate: { $gte: range.from, $lte: range.to }, status: { $in: ["resolved", "unresolved"] } } },
    {
      $group: {
        _id: { stationId: "$stationId", direction: "$direction", horizonMin: "$horizonMin", source: "$source" },
        errors: { $push: { $cond: [isResolved, "$errorSec", "$$REMOVE"] } },
        unresolvedCount: { $sum: { $cond: [isResolved, 0, 1] } },
      },
    },
    {
      $project: {
        errors: { $sortArray: { input: "$errors", sortBy: 1 } },
        absErrors: { $sortArray: { input: { $map: { input: "$errors", in: { $abs: "$$this" } } }, sortBy: 1 } },
        unresolvedCount: 1,
      },
    },
    {
      $project: {
        _id: 0,
        stationId: "$_id.stationId",
        direction: "$_id.direction",
        horizonMin: "$_id.horizonMin",
        source: "$_id.source",
        count: { $size: "$errors" },
        medianErrorSec: toNearestRank("$errors", MEDIAN),
        medianAbsErrorSec: toNearestRank("$absErrors", MEDIAN),
        p90AbsErrorSec: toNearestRank("$absErrors", P90),
        unresolvedCount: 1,
      },
    },
    { $sort: { stationId: 1, direction: -1, horizonMin: -1, source: 1 } },
  ];
}
