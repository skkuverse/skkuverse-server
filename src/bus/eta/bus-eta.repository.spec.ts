/**
 * BusEtaRepository over a mocked Mongo seam (src/infra/db): the frozen skip,
 * the offsets-length guard, the reads' filters and bounds, and the indexes it
 * ensures at boot, only with SHUTTLE_ETA on.
 */
jest.mock("../../infra/db", () => ({ getClient: jest.fn(), HOT_READ_MAX_TIME_MS: 3_000 }));
jest.mock("../../infra/config", () => ({ mongo: { dbName: "bus_campus_test" }, shuttleEta: { enabled: true } }));
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { liveDoc } from "./bus-eta.mapper";
import { BusEtaRepository } from "./bus-eta.repository";
import type { EtaRun } from "./bus-eta.types";

const { getClient } = require("../../infra/db");
const config = require("../../infra/config");
const logger = require("../../infra/logger");
const repository = new BusEtaRepository();

const RUN: EtaRun = {
  serviceId: "campus-inja",
  routeType: "regular",
  date: "2026-10-12",
  time: "10:00",
  departAt: new Date("2026-10-12T01:00:00.000Z"),
};
const FETCHED = new Date("2026-10-12T00:20:00.000Z");
const seqLength = (serviceId: string, routeType: string) =>
  serviceId === "campus-inja" && routeType === "regular" ? 3 : undefined;

let frozenInDb: Array<{ _id: string; offsetsSec: number[] }>;
const coll = {
  find: jest.fn(() => ({ toArray: async () => frozenInDb })),
  bulkWrite: jest.fn(async () => ({})),
  createIndex: jest.fn(async () => "ok"),
};
const db = { collection: jest.fn(() => coll) };

beforeEach(() => {
  frozenInDb = [];
  jest.clearAllMocks();
  getClient.mockReturnValue({ db: jest.fn(() => db) });
});

describe("BusEtaRepository.upsertEstimates", () => {
  it("upserts by _id", async () => {
    // Act
    const doc = liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });

    // Assert
    await expect(repository.upsertEstimates([doc], seqLength)).resolves.toEqual({ written: 1, skippedFrozen: 0 });
    expect(coll.bulkWrite).toHaveBeenCalledWith(
      [{ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }],
      { ordered: false },
    );
    expect(db.collection).toHaveBeenCalledWith("shuttle_eta");
  });

  it("skips a document that is already frozen", async () => {
    // Arrange
    const doc = liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });
    frozenInDb = [{ _id: doc._id, offsetsSec: [0, 2900, 3100] }];

    // Act & Assert
    await expect(repository.upsertEstimates([doc], seqLength)).resolves.toEqual({ written: 0, skippedFrozen: 1 });
    expect(coll.find).toHaveBeenCalledWith(
      { _id: { $in: [doc._id] }, frozen: true },
      { projection: { _id: 1, offsetsSec: 1 }, maxTimeMS: 3_000 },
    );
    expect(coll.bulkWrite).not.toHaveBeenCalled();
  });

  it("replaces a frozen document for another stop count: the catalog changed since it was fixed", async () => {
    // Arrange
    const doc = liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });
    frozenInDb = [{ _id: doc._id, offsetsSec: [0, 3000] }];

    // Act & Assert
    await expect(repository.upsertEstimates([doc], seqLength)).resolves.toEqual({ written: 1, skippedFrozen: 0 });
    expect(coll.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("rejects offsets that do not fit the sequence, before writing anything", async () => {
    // Arrange
    const good = liveDoc(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });

    // Act
    const bad = liveDoc({ ...RUN, time: "12:00" }, { offsetsSec: [0, 3000], fetchedAt: FETCHED });

    // Assert
    await expect(repository.upsertEstimates([good, bad], seqLength)).rejects.toThrow(
      "shuttle_eta campus-inja|regular|2026-10-12|12:00|live: 2 offsets for a sequence of 3 stops",
    );
    expect(coll.bulkWrite).not.toHaveBeenCalled();
  });

  it("writes nothing for an empty batch", async () => {
    // Act & Assert
    await expect(repository.upsertEstimates([], seqLength)).resolves.toEqual({ written: 0, skippedFrozen: 0 });
    expect(coll.find).not.toHaveBeenCalled();
  });
});

describe("BusEtaRepository reads and indexes", () => {
  it("reads only unexpired documents, capped like every hot read", async () => {
    // Arrange
    const now = new Date("2026-10-12T02:00:00.000Z");

    // Act
    await repository.listUnexpired(now);

    // Assert
    expect(coll.find).toHaveBeenCalledWith({ expiresAt: { $gt: now } }, { maxTimeMS: 3_000 });
  });

  it("creates the TTL index on expiresAt and the poller's lookup index", async () => {
    // Act
    await repository.onModuleInit();

    // Assert
    expect(coll.createIndex).toHaveBeenCalledWith({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });
    expect(coll.createIndex).toHaveBeenCalledWith({ serviceId: 1, date: 1, kind: 1 }, { name: "serviceId_date_kind" });
  });

  it("reads the documents of some services on some dates, bounded", async () => {
    // Act
    await repository.listEstimates(["campus-inja"], ["2026-10-12"]);

    // Assert
    expect(coll.find).toHaveBeenCalledWith({ serviceId: { $in: ["campus-inja"] }, date: { $in: ["2026-10-12"] } }, { maxTimeMS: 3_000 });
  });

  it("SHUTTLE_ETA=off touches no collection and says so once", async () => {
    // Arrange
    config.shuttleEta.enabled = false;

    // Act & Assert
    try {
      await repository.onModuleInit();
      expect(coll.createIndex).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith({ event: "bus.eta.disabled" }, expect.any(String));
    } finally {
      config.shuttleEta.enabled = true;
    }
  });
});
