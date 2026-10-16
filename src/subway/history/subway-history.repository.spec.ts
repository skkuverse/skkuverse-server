/**
 * SubwayHistoryRepository over `subway_events` and `subway_predictions`. What it
 * guards: at boot `subway_events` is created as a time-series collection on
 * `at` with `meta` as its meta field, expiring after 180 days, and an existing
 * one is left as it is; `subway_predictions` gets its unique key (service
 * date, train, station, horizon), a partial index on the open records'
 * predicted instants for the unresolved sweep, and a 180-day TTL on `madeAt`.
 * Each tick writes in batches: one unordered insert of new events, one
 * unordered bulk of insert-only upserts of crossed horizons, one update per
 * observed arrival computing each open record's error from its own
 * prediction, and one update marking the open records 30 minutes past their
 * predicted arrival unresolved. The report runs one bounded aggregation over
 * the range's resolved and unresolved records. A database error rejects; the
 * service decides what that means.
 */
const insertMany = jest.fn();
const bulkWrite = jest.fn();
const updateMany = jest.fn();
const createIndexes = jest.fn();
const toArray = jest.fn();
const aggregate = jest.fn((..._args: unknown[]) => ({ toArray }));
const mongoCollection = jest.fn((_db: string, _name: string) => ({ insertMany, bulkWrite, updateMany, createIndexes, aggregate }));
const createCollection = jest.fn();
const db = jest.fn((_name: string) => ({ createCollection }));

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../infra/db", () => ({ ...jest.requireActual("../../infra/db"), getClient: () => ({ db }) }));
jest.mock("../../infra/mongo", () => ({
  ...jest.requireActual("../../infra/mongo"),
  mongoCollection: (...args: [string, string]) => mongoCollection(...args),
}));

import config from "../../infra/config";
import logger from "../../infra/logger";
import type { SubwayEventDoc, SubwayPredictionDoc } from "./subway-history.document";
import { toAccuracyPipeline } from "./subway-history.query";
import { SubwayHistoryRepository } from "./subway-history.repository";

const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);
const DAYS_180_SEC = 15_552_000;

const EVENT: SubwayEventDoc = {
  at: at("21:05:50"),
  meta: { line: "1", trainNo: "0692" },
  stationId: "KR-1-0153",
  state: "arrived",
  source: "seoul-subway-api",
};

const PREDICTION: SubwayPredictionDoc = {
  serviceDate: "2026-10-16",
  trainNo: "0692",
  stationId: "KR-1-0153",
  horizonMin: 3,
  direction: "up",
  source: "estimated",
  predictedAt: at("21:05:30"),
  madeAt: at("21:02:31"),
  status: "open",
  observedAt: null,
  observedState: null,
  resolvedAt: null,
  errorSec: null,
};

let repository: SubwayHistoryRepository;

beforeEach(() => {
  jest.clearAllMocks();
  repository = new SubwayHistoryRepository();
});

describe("SubwayHistoryRepository.onModuleInit", () => {
  it("creates subway_events as a time-series collection on at, meta as its meta field, expiring after 180 days", async () => {
    // Act
    await repository.onModuleInit();

    // Assert
    expect(db).toHaveBeenCalledWith(config.mongo.dbName);
    expect(createCollection).toHaveBeenCalledWith("subway_events", {
      timeseries: { timeField: "at", metaField: "meta", granularity: "seconds" },
      expireAfterSeconds: DAYS_180_SEC,
    });
  });

  it("creates the predictions' unique key, the open records' partial index and the 180-day TTL", async () => {
    // Act
    await repository.onModuleInit();

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "subway_predictions");
    expect(createIndexes).toHaveBeenCalledWith([
      { key: { serviceDate: 1, trainNo: 1, stationId: 1, horizonMin: 1 }, name: "prediction_key", unique: true },
      { key: { predictedAt: 1 }, name: "open_predicted_at", partialFilterExpression: { status: "open" } },
      { key: { madeAt: 1 }, name: "made_at_ttl", expireAfterSeconds: DAYS_180_SEC },
    ]);
  });

  it("leaves an existing subway_events as it is and still creates the predictions' indexes", async () => {
    // Arrange
    createCollection.mockRejectedValueOnce(Object.assign(new Error("Collection already exists"), { code: 48, codeName: "NamespaceExists" }));

    // Act
    await repository.onModuleInit();

    // Assert
    expect(createIndexes).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ event: "subway.history.indexes.ensured" }, expect.any(String));
  });
});

describe("SubwayHistoryRepository.insertEvents", () => {
  it("inserts a tick's new events in one unordered write", async () => {
    // Act
    await repository.insertEvents([EVENT]);

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "subway_events");
    expect(insertMany).toHaveBeenCalledWith([EVENT], { ordered: false });
  });

  it("writes nothing for no event", async () => {
    // Act
    await repository.insertEvents([]);

    // Assert
    expect(insertMany).not.toHaveBeenCalled();
  });
});

describe("SubwayHistoryRepository.upsertPredictions", () => {
  it("inserts each crossed horizon once, keyed by service date, train, station and horizon, in one unordered bulk", async () => {
    // Act
    await repository.upsertPredictions([PREDICTION]);

    // Assert
    expect(bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { serviceDate: "2026-10-16", trainNo: "0692", stationId: "KR-1-0153", horizonMin: 3 },
            update: { $setOnInsert: PREDICTION },
            upsert: true,
          },
        },
      ],
      { ordered: false },
    );
  });

  it("writes nothing for no prediction", async () => {
    // Act
    await repository.upsertPredictions([]);

    // Assert
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});

describe("SubwayHistoryRepository.updateObservedArrival", () => {
  it("resolves the train's open records at the station in one update, each error from its own predicted instant", async () => {
    // Arrange
    const observedAt = at("21:05:50");

    // Act
    await repository.updateObservedArrival(
      { serviceDate: "2026-10-16", trainNo: "0692", stationId: "KR-1-0153", observedAt, observedState: "arrived" },
      at("21:05:51"),
    );

    // Assert
    expect(updateMany).toHaveBeenCalledWith({ serviceDate: "2026-10-16", trainNo: "0692", stationId: "KR-1-0153", status: "open" }, [
      {
        $set: {
          status: "resolved",
          observedAt,
          observedState: "arrived",
          resolvedAt: at("21:05:51"),
          errorSec: { $divide: [{ $subtract: ["$predictedAt", observedAt] }, 1000] },
        },
      },
    ]);
  });
});

describe("SubwayHistoryRepository.updateUnresolvedPredictions", () => {
  it("marks the open records predicted before the cutoff unresolved, with no error", async () => {
    // Act
    await repository.updateUnresolvedPredictions(at("21:05:30"), at("21:35:30"));

    // Assert
    expect(updateMany).toHaveBeenCalledWith(
      { status: "open", predictedAt: { $lt: at("21:05:30") } },
      { $set: { status: "unresolved", resolvedAt: at("21:35:30") } },
    );
  });
});

describe("SubwayHistoryRepository.listAccuracyGroups", () => {
  it("aggregates the range's resolved and unresolved records by service date, bounded", async () => {
    // Arrange
    const groups = [{ stationId: "KR-1-0153", count: 1 }];
    toArray.mockResolvedValueOnce(groups);
    const range = { from: "2026-10-10", to: "2026-10-16" };

    // Act
    const result = await repository.listAccuracyGroups(range);

    // Assert
    expect(result).toBe(groups);
    expect(aggregate).toHaveBeenCalledWith(toAccuracyPipeline(range), { maxTimeMS: 30_000 });
    expect((aggregate.mock.calls[0]?.[0] as unknown[])[0]).toEqual({
      $match: { serviceDate: { $gte: "2026-10-10", $lte: "2026-10-16" }, status: { $in: ["resolved", "unresolved"] } },
    });
  });

  it("propagates a database error", async () => {
    // Arrange
    toArray.mockRejectedValueOnce(new Error("maxTimeMS expired"));

    // Act & Assert
    await expect(repository.listAccuracyGroups({ from: "2026-10-10", to: "2026-10-16" })).rejects.toThrow("maxTimeMS expired");
  });
});
