import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection, IndexDescription } from "mongodb";
import config from "../../infra/config";
import { getClient } from "../../infra/db";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import { HISTORY_TTL_SEC } from "./subway-history.constants";
import type { SubwayEventDoc, SubwayPredictionDoc } from "./subway-history.document";
import {
  toAccuracyPipeline,
  toObservedArrivalFilter,
  toObservedArrivalUpdate,
  toUnresolvedFilter,
  toUnresolvedUpdate,
} from "./subway-history.query";
import type { AccuracyGroup, AccuracyRange, ObservedArrival } from "./subway-history.types";

// WHY: an operator's report over up to 180 days of records, not a hot read.
const REPORT_MAX_TIME_MS = 30_000;

const EVENTS_OPTIONS = {
  timeseries: { timeField: "at", metaField: "meta", granularity: "seconds" },
  expireAfterSeconds: HISTORY_TTL_SEC,
} as const;

const PREDICTION_INDEXES: IndexDescription[] = [
  { key: { serviceDate: 1, trainNo: 1, stationId: 1, horizonMin: 1 }, name: "prediction_key", unique: true },
  { key: { predictedAt: 1 }, name: "open_predicted_at", partialFilterExpression: { status: "open" } },
  { key: { madeAt: 1 }, name: "made_at_ttl", expireAfterSeconds: HISTORY_TTL_SEC },
];

// QUIRK(mongodb): createCollection fails with NamespaceExists (48) when the collection is there, as after the
// first boot or when another replica booting at once made it first.
const NAMESPACE_EXISTS = 48;

@Injectable()
export class SubwayHistoryRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("subway.history", async () => {
      await this.createEventsCollection();
      await this.subwayPredictions().createIndexes(PREDICTION_INDEXES);
    });
  }

  async insertEvents(events: readonly SubwayEventDoc[]): Promise<void> {
    if (events.length === 0) return;
    await this.subwayEvents().insertMany([...events], { ordered: false });
  }

  async upsertPredictions(predictions: readonly SubwayPredictionDoc[]): Promise<void> {
    if (predictions.length === 0) return;
    const inserts = predictions.map((prediction) => {
      const { serviceDate, trainNo, stationId, horizonMin } = prediction;
      return { updateOne: { filter: { serviceDate, trainNo, stationId, horizonMin }, update: { $setOnInsert: prediction }, upsert: true } };
    });
    await this.subwayPredictions().bulkWrite(inserts, { ordered: false });
  }

  async updateObservedArrival(arrival: ObservedArrival, resolvedAt: Date): Promise<void> {
    await this.subwayPredictions().updateMany(toObservedArrivalFilter(arrival, resolvedAt), toObservedArrivalUpdate(arrival, resolvedAt));
  }

  async updateUnresolvedPredictions(cutoff: Date, markedAt: Date): Promise<void> {
    await this.subwayPredictions().updateMany(toUnresolvedFilter(cutoff), toUnresolvedUpdate(markedAt));
  }

  listAccuracyGroups(range: AccuracyRange): Promise<AccuracyGroup[]> {
    return this.subwayPredictions().aggregate<AccuracyGroup>(toAccuracyPipeline(range), { maxTimeMS: REPORT_MAX_TIME_MS }).toArray();
  }

  private async createEventsCollection(): Promise<void> {
    try {
      await getClient().db(config.mongo.dbName).createCollection(config.subway.collections.events, EVENTS_OPTIONS);
    } catch (err) {
      if ((err as { code?: unknown }).code !== NAMESPACE_EXISTS) throw err;
    }
  }

  private subwayEvents(): Collection<SubwayEventDoc> {
    return mongoCollection<SubwayEventDoc>(config.mongo.dbName, config.subway.collections.events);
  }

  private subwayPredictions(): Collection<SubwayPredictionDoc> {
    return mongoCollection<SubwayPredictionDoc>(config.mongo.dbName, config.subway.collections.predictions);
  }
}
