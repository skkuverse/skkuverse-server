/**
 * BusEtaRepository over a mocked Mongo seam (src/infra/db): the frozen skip,
 * the offsets-length guard, the reads' filters and bounds, and the indexes it
 * ensures at boot, only with SHUTTLE_ETA on. A live value's travel model is
 * stored with it and never outlives it, and a document from before the model
 * existed reads as it was stored.
 */
jest.mock("../../infra/db", () => ({ getClient: jest.fn(), HOT_READ_MAX_TIME_MS: 3_000 }));
jest.mock("../../infra/config", () => ({ mongo: { dbName: "bus_campus_test" }, shuttleEta: { enabled: true } }));
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import type { ShuttleEtaDoc } from "./bus-eta.document";
import { etaDocId } from "./bus-eta.mapper";
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

// WHY: a live document as the live poller writes it (live/bus-eta-live.mapper.ts); a root spec does not import
// a child flow.
function liveEstimate(run: EtaRun, { offsetsSec, fetchedAt }: { offsetsSec: number[]; fetchedAt: Date }): ShuttleEtaDoc {
  const expiresAt = new Date(run.departAt.getTime() + 8 * 24 * 60 * 60_000);
  return { _id: etaDocId(run, "live"), kind: "live", ...run, offsetsSec, source: "naver", fetchedAt, expiresAt };
}
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
    const doc = liveEstimate(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });

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
    const doc = liveEstimate(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });
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
    const doc = liveEstimate(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });
    frozenInDb = [{ _id: doc._id, offsetsSec: [0, 3000] }];

    // Act & Assert
    await expect(repository.upsertEstimates([doc], seqLength)).resolves.toEqual({ written: 1, skippedFrozen: 0 });
    expect(coll.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("rejects offsets that do not fit the sequence, before writing anything", async () => {
    // Arrange
    const good = liveEstimate(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });

    // Act
    const bad = liveEstimate({ ...RUN, time: "12:00" }, { offsetsSec: [0, 3000], fetchedAt: FETCHED });

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

  it("SHUTTLE_ETA=off touches no collection, and leaves saying so to the pollers", async () => {
    // Arrange
    config.shuttleEta.enabled = false;

    // Act & Assert
    try {
      await repository.onModuleInit();
      expect(coll.createIndex).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    } finally {
      config.shuttleEta.enabled = true;
    }
  });
});

describe("BusEtaRepository travel model", () => {
  const travel = { model: "busLane" as const, corridorCarSec: 1920, corridorSec: 1080, spanCount: 6, coverage: 0.81 };

  it("stores a bus-lane value's travel model with it", async () => {
    // Arrange
    const doc = { ...liveEstimate(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED }), travel };

    // Act
    await repository.upsertEstimates([doc], seqLength);

    // Assert
    expect(coll.bulkWrite).toHaveBeenCalledWith([{ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }], { ordered: false });
  });

  it("replaces the whole document, so a later car value keeps no travel model from an earlier one", async () => {
    // Arrange
    const car = liveEstimate(RUN, { offsetsSec: [0, 3300, 3500], fetchedAt: FETCHED });

    // Act
    await repository.upsertEstimates([car], seqLength);

    // Assert
    const [[operations]] = coll.bulkWrite.mock.calls as unknown as [[Array<{ replaceOne: { replacement: ShuttleEtaDoc } }>]];
    expect(operations).toHaveLength(1);
    expect(operations[0]!.replaceOne.replacement).not.toHaveProperty("travel");
  });

  it("reads a document written before the travel model existed as it was stored", async () => {
    // Arrange
    const old = liveEstimate(RUN, { offsetsSec: [0, 3000, 3200], fetchedAt: FETCHED });
    frozenInDb = [old];

    // Act
    const docs = await repository.listEstimates(["campus-inja"], ["2026-10-12"]);

    // Assert
    expect(docs).toEqual([old]);
    expect(coll.find).toHaveBeenCalledWith({ serviceId: { $in: ["campus-inja"] }, date: { $in: ["2026-10-12"] } }, { maxTimeMS: 3_000 });
  });
});

describe("BusEtaRepository.listFixedEstimates", () => {
  // 04:00 KST on Tuesday 2026-10-20.
  const NOW = new Date("2026-10-19T19:00:00.000Z");
  const FIXED = {
    _id: "campus-inja|regular|2026-10-13|13:30|live",
    serviceId: "campus-inja",
    routeType: "regular",
    date: "2026-10-13",
    time: "13:30",
    offsetsSec: [0, 4320],
  };

  it("reads the unexpired fixed live values of some services on some dates, only the fields a reuse needs, bounded", async () => {
    // Arrange
    frozenInDb = [FIXED];

    // Act
    const fixed = await repository.listFixedEstimates(["campus-inja"], ["2026-10-13", "2026-10-06"], NOW);

    // Assert
    expect(fixed).toEqual([FIXED]);
    expect(coll.find).toHaveBeenCalledWith(
      { kind: "live", frozen: true, serviceId: { $in: ["campus-inja"] }, date: { $in: ["2026-10-13", "2026-10-06"] }, expiresAt: { $gt: NOW } },
      { projection: { _id: 1, serviceId: 1, routeType: 1, date: 1, time: 1, offsetsSec: 1 }, maxTimeMS: 3_000 },
    );
  });

  it("leaves out a document that does not parse, and logs it by its id", async () => {
    // Arrange
    const broken = { ...FIXED, _id: "campus-inja|regular|2026-10-06|13:30|live", offsetsSec: undefined } as unknown as typeof FIXED;
    frozenInDb = [broken, FIXED];

    // Act
    const fixed = await repository.listFixedEstimates(["campus-inja"], ["2026-10-13", "2026-10-06"], NOW);

    // Assert
    expect(fixed).toEqual([FIXED]);
    expect(logger.warn).toHaveBeenCalledWith(
      { event: "bus.eta.invalid_document", count: 1, invalid: ["campus-inja|regular|2026-10-06|13:30|live: offsetsSec"] },
      expect.any(String),
    );
  });
});

describe("BusEtaRepository.upsertEstimates derivedFrom", () => {
  it("stores a reused prediction with the fixed value it came from", async () => {
    // Arrange
    const fetchedAt = new Date("2026-10-19T19:00:00.000Z");
    const reused: ShuttleEtaDoc = {
      _id: etaDocId(RUN, "baseline"),
      kind: "baseline",
      ...RUN,
      offsetsSec: [0, 3000, 3200],
      source: "naver",
      fetchedAt,
      derivedFrom: "campus-inja|regular|2026-10-05|10:00|live",
      expiresAt: new Date(fetchedAt.getTime() + 24 * 3600_000),
    };

    // Act
    await repository.upsertEstimates([reused], seqLength);

    // Assert
    expect(coll.bulkWrite).toHaveBeenCalledWith(
      [{ replaceOne: { filter: { _id: reused._id }, replacement: reused, upsert: true } }],
      { ordered: false },
    );
  });
});
