/**
 * BusRealtimeHsscRepository over a mocked Mongo seam (src/infra/db): feed
 * events are appended unordered into hssc_feed_events, an event the unique
 * index already holds counts as not inserted rather than failing the write,
 * any other failure rejects, an empty batch touches no collection, and boot
 * ensures the unique event index and the 180-day TTL on polledAt.
 */
jest.mock("../../../infra/db", () => ({ getClient: jest.fn(), HOT_READ_MAX_TIME_MS: 3_000 }));
jest.mock("../../../infra/config", () => ({ mongo: { dbName: "bus_campus_test" } }));
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { MongoBulkWriteError } from "mongodb";
import type { HsscFeedEventDoc } from "./bus-realtime-hssc.document";
import { BusRealtimeHsscRepository } from "./bus-realtime-hssc.repository";

const { getClient } = require("../../../infra/db");

const repository = new BusRealtimeHsscRepository();
const EVENT: HsscFeedEventDoc = {
  lineNo: "32149",
  seq: 6,
  stopNo: "284258",
  stopName: "600주년기념관 앞-하교",
  inout: "LEFT",
  getDate: new Date("2026-10-20T00:59:30.000Z"),
  rawGetDate: "2026-10-20 오전 9:59:30",
  polledAt: new Date("2026-10-20T00:59:40.000Z"),
};

const coll = {
  insertMany: jest.fn(async (events: unknown[]) => ({ insertedCount: events.length })),
  createIndex: jest.fn(async () => "ok"),
};
const db = { collection: jest.fn(() => coll) };
const dbOf = jest.fn(() => db);

function bulkWriteError(writeErrorCodes: number[], insertedCount: number): MongoBulkWriteError {
  return new MongoBulkWriteError(
    { message: "bulk write failed", code: writeErrorCodes[0], writeErrors: writeErrorCodes.map((code) => ({ code })) } as never,
    { insertedCount } as never,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  getClient.mockReturnValue({ db: dbOf });
});

describe("BusRealtimeHsscRepository.recordFeedEvents", () => {
  it("appends the events into hssc_feed_events, unordered", async () => {
    // Act
    const inserted = await repository.recordFeedEvents([EVENT]);

    // Assert
    expect(inserted).toBe(1);
    expect(dbOf).toHaveBeenCalledWith("bus_campus_test");
    expect(db.collection).toHaveBeenCalledWith("hssc_feed_events");
    expect(coll.insertMany).toHaveBeenCalledWith([EVENT], { ordered: false });
  });

  it("writes nothing for an empty batch", async () => {
    // Act
    const inserted = await repository.recordFeedEvents([]);

    // Assert
    expect(inserted).toBe(0);
    expect(coll.insertMany).not.toHaveBeenCalled();
  });

  it("counts the events the unique index already holds as not inserted", async () => {
    // Arrange
    coll.insertMany.mockRejectedValueOnce(bulkWriteError([11000, 11000], 1));

    // Act & Assert
    expect(await repository.recordFeedEvents([EVENT, { ...EVENT, seq: 7 }, { ...EVENT, seq: 8 }])).toBe(1);
  });

  it("rejects when a write fails for another reason beside a duplicate", async () => {
    // Arrange
    const failure = bulkWriteError([11000, 121], 1);
    coll.insertMany.mockRejectedValueOnce(failure);

    // Act & Assert
    await expect(repository.recordFeedEvents([EVENT])).rejects.toBe(failure);
  });

  it("rejects on a failure that is no bulk write error", async () => {
    // Arrange
    coll.insertMany.mockRejectedValueOnce(new Error("atlas down"));

    // Act & Assert
    await expect(repository.recordFeedEvents([EVENT])).rejects.toThrow("atlas down");
  });
});

describe("BusRealtimeHsscRepository.onModuleInit", () => {
  it("creates the unique event index and the 180-day TTL on polledAt", async () => {
    // Act
    await repository.onModuleInit();

    // Assert
    expect(coll.createIndex.mock.calls).toEqual([
      [{ lineNo: 1, seq: 1, getDate: 1, inout: 1 }, { unique: true, name: "lineNo_seq_getDate_inout_unique" }],
      [{ polledAt: 1 }, { expireAfterSeconds: 15_552_000, name: "polledAt_ttl" }],
    ]);
  });
});
