/**
 * BusCacheRepository over a mocked Mongo seam (src/infra/db): the TTL index
 * it ensures at boot (warning, never failing, when it cannot), the upsert shape with the key as `_id`, and the 5 s in-memory layer
 * over the read (a memory hit, a cached null, a re-read after the TTL).
 */

const mockCreateIndex = jest.fn().mockResolvedValue("ttl_updatedAt");
const mockUpdateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
const mockFindOne = jest.fn();
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock("../../infra/logger", () => mockLogger);

jest.mock("../../infra/db", () => ({
  getClient: jest.fn().mockReturnValue({
    db: jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({
        createIndex: mockCreateIndex,
        updateOne: mockUpdateOne,
        findOne: mockFindOne,
      }),
    }),
  }),
}));

jest.mock("../../infra/config", () => ({
  mongo: {
    dbName: "skkubus_test",
    collections: { busCache: "bus_cache" },
  },
  cache: { enabled: true },
}));

import { hsscBusDoc, jongroArrivalDoc } from "../../../__tests__/helpers/bus/bus-cache-docs";
import type { Clock } from "../../infra/clock";
import { BusCacheRepository } from "./bus-cache.repository";

const NOW = new Date("2026-10-20T01:00:00Z");
const clock: Clock = { now: () => NOW };

let busCache: BusCacheRepository;

beforeEach(() => {
  jest.clearAllMocks();
  // Fresh instance each test so the in-mem map starts empty.
  busCache = new BusCacheRepository(clock);
});

describe("BusCacheRepository.onModuleInit", () => {
  it("creates TTL index on _updatedAt with 60s expiry", async () => {
    // Act
    await busCache.onModuleInit();

    // Assert
    expect(mockCreateIndex).toHaveBeenCalledWith(
      { _updatedAt: 1 },
      { expireAfterSeconds: 60, name: "ttl_updatedAt" },
    );
    expect(mockLogger.info).toHaveBeenCalledWith({ event: "bus.cache.indexes.ensured" }, expect.any(String));
  });

  it("warns and carries on when the index cannot be created", async () => {
    // Arrange
    mockCreateIndex.mockRejectedValueOnce(new Error("atlas down"));

    // Act
    await busCache.onModuleInit();

    // Assert
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "bus.cache.indexes.failed" }), expect.any(String));
  });
});

describe("BusCacheRepository.upsert", () => {
  it("upserts document with data and _updatedAt Date", async () => {
    // Arrange
    const payload = [hsscBusDoc()];

    // Act
    await busCache.upsert("hssc", payload);

    // Assert
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "hssc" },
      expect.objectContaining({
        $set: expect.objectContaining({
          data: payload,
          _updatedAt: expect.any(Date),
        }),
      }),
      { upsert: true },
    );
  });

  it("uses the provided key as _id", async () => {
    // Act
    await busCache.upsert("jongro_stations_07", []);

    // Assert
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "jongro_stations_07" },
      expect.anything(),
      expect.anything(),
    );
  });

  it("stamps _updatedAt with the clock's time", async () => {
    // Act
    await busCache.upsert("station", "3분후[2번째 전]");

    // Assert
    expect(mockUpdateOne.mock.calls[0]![1]).toEqual({ $set: { data: "3분후[2번째 전]", _updatedAt: NOW } });
  });
});

describe("BusCacheRepository.findValue", () => {
  it("returns doc.data when document exists", async () => {
    // Arrange
    const cached = [{ seq: 1 }];
    mockFindOne.mockResolvedValueOnce({
      _id: "hssc",
      data: cached,
      _updatedAt: new Date(),
    });

    // Act
    const result = await busCache.findValue("hssc");

    // Assert
    expect(result).toEqual(cached);
    expect(mockFindOne).toHaveBeenCalledWith({ _id: "hssc" });
  });

  it("returns null when document does not exist (TTL expired or first boot)", async () => {
    // Arrange
    mockFindOne.mockResolvedValueOnce(null);

    // Act
    const result = await busCache.findValue("station");

    // Assert
    expect(result).toBeNull();
  });

  it("fetches from MongoDB on first call and caches the result", async () => {
    // Arrange
    const data = [jongroArrivalDoc()];
    mockFindOne.mockResolvedValueOnce({
      _id: "jongro_stations_07",
      data,
      _updatedAt: new Date(),
    });

    // Act
    const result = await busCache.findValue("jongro_stations_07");

    // Assert
    expect(result).toEqual(data);
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  it("serves from memory on subsequent call within TTL — no MongoDB round-trip", async () => {
    // Arrange
    const data = [jongroArrivalDoc({ stationName: "성균관대입구" })];
    mockFindOne.mockResolvedValueOnce({
      _id: "jongro_stations_02",
      data,
      _updatedAt: new Date(),
    });
    await busCache.findValue("jongro_stations_02");
    jest.clearAllMocks();

    // Act
    const result = await busCache.findValue("jongro_stations_02");

    // Assert
    expect(result).toEqual(data);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("caches null result when MongoDB has no document", async () => {
    // Arrange
    mockFindOne.mockResolvedValueOnce(null);
    const first = await busCache.findValue("jongro_locations_08");
    expect(first).toBeNull();
    jest.clearAllMocks();

    // Act
    const second = await busCache.findValue("jongro_locations_08");

    // Assert
    expect(second).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("re-queries after the in-mem TTL expires", async () => {
    // Arrange
    mockFindOne.mockResolvedValue({
      _id: "station",
      data: "3분후[2번째 전]",
      _updatedAt: new Date(),
    });
    let now = 1_000_000;
    jest.useFakeTimers({ now });

    try {
      // Act & Assert
      await busCache.findValue("station");
      expect(mockFindOne).toHaveBeenCalledTimes(1);

      // Within TTL → memory
      await busCache.findValue("station");
      expect(mockFindOne).toHaveBeenCalledTimes(1);

      // Advance past TTL → re-query
      now += 5001;
      jest.setSystemTime(now);
      await busCache.findValue("station");
      expect(mockFindOne).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

// WHY: a burst of realtime requests on a cold key must cost one bus_cache read per replica, CACHE=off included,
// since that memory bounds reads rather than staleness.
describe("BusCacheRepository.findValue under concurrent misses", () => {
  const config = jest.requireMock("../../infra/config") as { cache: { enabled: boolean } };

  it("reads once for concurrent misses of one key", async () => {
    // Arrange
    mockFindOne.mockResolvedValueOnce({ _id: "hssc", data: [hsscBusDoc()], _updatedAt: NOW });

    // Act
    const reads = await Promise.all([busCache.findValue("hssc"), busCache.findValue("hssc"), busCache.findValue("hssc")]);

    // Assert
    expect(mockFindOne).toHaveBeenCalledTimes(1);
    expect(reads).toEqual([[hsscBusDoc()], [hsscBusDoc()], [hsscBusDoc()]]);
  });

  it("reads once for concurrent misses of one key with CACHE=off", async () => {
    // Arrange
    config.cache.enabled = false;
    mockFindOne.mockResolvedValueOnce({ _id: "hssc", data: [hsscBusDoc()], _updatedAt: NOW });

    try {
      // Act
      await Promise.all([busCache.findValue("hssc"), busCache.findValue("hssc"), busCache.findValue("hssc")]);
      await busCache.findValue("hssc");

      // Assert
      expect(mockFindOne).toHaveBeenCalledTimes(1);
    } finally {
      config.cache.enabled = true;
    }
  });
});

describe("BusCacheRepository.findValue on a missing key", () => {
  const START_MS = Date.parse("2026-10-20T01:00:00Z");
  let nowMs: number;
  let repository: BusCacheRepository;
  const missingWarnings = () => mockLogger.warn.mock.calls.filter(([fields]) => fields.event === "bus.cache.missing");
  const advanceTo = (ms: number) => {
    nowMs = ms;
    jest.setSystemTime(ms);
  };

  beforeEach(() => {
    nowMs = START_MS;
    jest.useFakeTimers({ now: START_MS });
    repository = new BusCacheRepository({ now: () => new Date(nowMs) });
    mockFindOne.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
    mockFindOne.mockReset();
  });

  it("warns bus.cache.missing with the key", async () => {
    // Act
    await repository.findValue("jongro_locations_07");

    // Assert
    expect(missingWarnings()).toEqual([[{ event: "bus.cache.missing", key: "jongro_locations_07", suppressed: 0 }, expect.any(String)]]);
  });

  it("warns once a minute per key, counting the reads it skipped", async () => {
    // Arrange
    await repository.findValue("hssc");
    advanceTo(START_MS + 5_001);
    await repository.findValue("hssc");
    advanceTo(START_MS + 59_999);
    await repository.findValue("hssc");

    // Act
    // WHY: past the minute and past the 5 s memory of the 59_999 read, so the read reaches Mongo again.
    advanceTo(START_MS + 65_000);
    await repository.findValue("hssc");

    // Assert
    expect(missingWarnings().map(([fields]) => fields.suppressed)).toEqual([0, 2]);
  });

  it("throttles each key on its own", async () => {
    // Act
    await repository.findValue("hssc");
    await repository.findValue("station");

    // Assert
    expect(missingWarnings().map(([fields]) => fields.key)).toEqual(["hssc", "station"]);
  });

  it("does not warn when the key holds an empty list, a poller's answer for no bus", async () => {
    // Arrange
    mockFindOne.mockResolvedValue({ _id: "jongro_locations_07", data: [], _updatedAt: NOW });

    // Act
    const value = await repository.findValue("jongro_locations_07");

    // Assert
    expect(value).toEqual([]);
    expect(missingWarnings()).toEqual([]);
  });

  it("does not warn when the key holds a value", async () => {
    // Arrange
    mockFindOne.mockResolvedValue({ _id: "station", data: "3분후[2번째 전]", _updatedAt: NOW });

    // Act
    await repository.findValue("station");

    // Assert
    expect(missingWarnings()).toEqual([]);
  });
});
