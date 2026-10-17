/**
 * In-memory SubwayHistoryRepository. `events` holds every inserted event in
 * order; `predictions` holds one record per service date, train, station and
 * horizon, which upsertPredictions inserts only when absent, as the real
 * `$setOnInsert` upsert does; updateObservedArrival resolves the train's records
 * at the station that isResolvableBy lets the row resolve, each with its own
 * error, and
 * updateUnresolvedPredictions marks open records predicted before the cutoff,
 * as the real updates do (all pinned in subway-history.repository.spec.ts).
 * listAccuracyGroups answers `accuracyGroups` and records each range asked:
 * the aggregation itself runs on a real mongod in
 * __tests__/nest/subway/subway-history.routes.test.ts. `failWith` makes every
 * write reject; `writes` counts the write calls.
 */
import type { SubwayEventDoc, SubwayPredictionDoc } from "../../../../src/subway/history/subway-history.document";
import type { SubwayHistoryRepository } from "../../../../src/subway/history/subway-history.repository";
import { isResolvableBy, toErrorSec } from "../../../../src/subway/history/subway-history.rules";
import type { AccuracyGroup, AccuracyRange, ObservedArrival } from "../../../../src/subway/history/subway-history.types";
import type { PublicOf } from "../public-of";

const keyOf = (record: Pick<SubwayPredictionDoc, "serviceDate" | "trainNo" | "stationId" | "horizonMin">): string =>
  `${record.serviceDate} ${record.trainNo} ${record.stationId} ${record.horizonMin}`;

export class FakeSubwayHistoryRepository implements PublicOf<SubwayHistoryRepository> {
  events: SubwayEventDoc[] = [];
  predictions = new Map<string, SubwayPredictionDoc>();
  accuracyGroups: AccuracyGroup[] = [];
  rangesAsked: AccuracyRange[] = [];
  failWith: Error | null = null;
  writes = 0;

  async onModuleInit(): Promise<void> {}

  async insertEvents(events: readonly SubwayEventDoc[]): Promise<void> {
    if (events.length === 0) return;
    this.write();
    this.events.push(...events.map((event) => ({ ...event, meta: { ...event.meta } })));
  }

  async upsertPredictions(predictions: readonly SubwayPredictionDoc[]): Promise<void> {
    if (predictions.length === 0) return;
    this.write();
    for (const prediction of predictions) {
      if (!this.predictions.has(keyOf(prediction))) this.predictions.set(keyOf(prediction), { ...prediction });
    }
  }

  async updateObservedArrival(arrival: ObservedArrival, resolvedAt: Date): Promise<void> {
    this.write();
    for (const [key, record] of this.predictions) {
      const isTrainAtStation = record.serviceDate === arrival.serviceDate && record.trainNo === arrival.trainNo && record.stationId === arrival.stationId;
      if (!isTrainAtStation || !isResolvableBy(record, arrival, resolvedAt)) continue;
      const { observedAt, observedState } = arrival;
      this.predictions.set(key, { ...record, status: "resolved", observedAt, observedState, resolvedAt, errorSec: toErrorSec(record.predictedAt, observedAt) });
    }
  }

  async updateUnresolvedPredictions(cutoff: Date, markedAt: Date): Promise<void> {
    this.write();
    for (const [key, record] of this.predictions) {
      if (record.status === "open" && record.predictedAt < cutoff) this.predictions.set(key, { ...record, status: "unresolved", resolvedAt: markedAt });
    }
  }

  async listAccuracyGroups(range: AccuracyRange): Promise<AccuracyGroup[]> {
    this.rangesAsked.push(range);
    return this.accuracyGroups.map((group) => ({ ...group }));
  }

  /** The records of one train at one station, by horizon, largest first. */
  recordsOf(trainNo: string, stationId: string): SubwayPredictionDoc[] {
    return [...this.predictions.values()]
      .filter((record) => record.trainNo === trainNo && record.stationId === stationId)
      .sort((a, b) => b.horizonMin - a.horizonMin);
  }

  private write(): void {
    this.writes += 1;
    if (this.failWith) throw this.failWith;
  }
}
