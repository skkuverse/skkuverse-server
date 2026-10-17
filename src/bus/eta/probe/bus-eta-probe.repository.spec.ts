/**
 * BusEtaProbeRepository over a mocked Mongo seam (src/infra/db): spans are
 * written by id, so recording one again changes nothing, an empty batch
 * touches no collection, and the 90-day TTL index on expiresAt is ensured at
 * boot, only with SHUTTLE_ETA on.
 */
jest.mock("../../../infra/db", () => ({ getClient: jest.fn(), HOT_READ_MAX_TIME_MS: 3_000 }));
jest.mock("../../../infra/config", () => ({ mongo: { dbName: "bus_campus_test" }, shuttleEta: { enabled: true } }));
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { spanDoc } from "./bus-eta-probe.mapper";
import { BusEtaProbeRepository } from "./bus-eta-probe.repository";

const { getClient } = require("../../../infra/db");
const config = require("../../../infra/config");

const repository = new BusEtaProbeRepository();
const SPAN = spanDoc({
  routeId: "228000175",
  vehId: "228000166",
  direction: "northbound",
  fromAlongM: 24_100,
  toAlongM: 4_300,
  fromAt: new Date("2026-10-16T11:34:00.000Z"),
  toAt: new Date("2026-10-16T11:44:00.000Z"),
  speedKmh: 118.8,
});

const coll = {
  bulkWrite: jest.fn(async () => ({})),
  createIndex: jest.fn(async () => "ok"),
};
const db = { collection: jest.fn(() => coll) };
const dbOf = jest.fn(() => db);

beforeEach(() => {
  jest.clearAllMocks();
  getClient.mockReturnValue({ db: dbOf });
});

describe("BusEtaProbeRepository.recordSpans", () => {
  it("writes each span by its id into bus_lane_spans, unordered", async () => {
    // Act
    const written = await repository.recordSpans([SPAN]);

    // Assert
    expect(written).toBe(1);
    expect(dbOf).toHaveBeenCalledWith("bus_campus_test");
    expect(db.collection).toHaveBeenCalledWith("bus_lane_spans");
    expect(coll.bulkWrite).toHaveBeenCalledWith([{ replaceOne: { filter: { _id: SPAN._id }, replacement: SPAN, upsert: true } }], { ordered: false });
  });

  it("writes nothing for an empty batch", async () => {
    // Act
    const written = await repository.recordSpans([]);

    // Assert
    expect(written).toBe(0);
    expect(coll.bulkWrite).not.toHaveBeenCalled();
  });
});

describe("BusEtaProbeRepository.onModuleInit", () => {
  it("creates the TTL index that expires a span at its expiresAt", async () => {
    // Act
    await repository.onModuleInit();

    // Assert
    expect(coll.createIndex).toHaveBeenCalledWith({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });
    expect(coll.createIndex).toHaveBeenCalledTimes(1);
  });

  it("SHUTTLE_ETA=off touches no collection", async () => {
    // Arrange
    config.shuttleEta.enabled = false;

    // Act & Assert
    try {
      await repository.onModuleInit();
      expect(db.collection).not.toHaveBeenCalled();
    } finally {
      config.shuttleEta.enabled = true;
    }
  });
});
