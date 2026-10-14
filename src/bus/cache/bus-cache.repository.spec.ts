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

import type { Clock } from "../../infra/clock";
import type { BusCacheKey } from "./bus-cache.document";
import { BusCacheRepository } from "./bus-cache.repository";

const NOW = new Date("2026-10-20T01:00:00Z");
const clock: Clock = { now: () => NOW };
const key = (name: string) => name as BusCacheKey;

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
    const payload = [{ stationName: "혜화역" }];

    // Act
    await busCache.upsert(key("hssc"), payload as never);

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
    const data = [{ stationName: "혜화역" }];
    mockFindOne.mockResolvedValueOnce({
      _id: "cr_test1",
      data,
      _updatedAt: new Date(),
    });

    // Act
    const result = await busCache.findValue(key("cr_test1"));

    // Assert
    expect(result).toEqual(data);
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  it("serves from memory on subsequent call within TTL — no MongoDB round-trip", async () => {
    // Arrange
    const data = [{ stationName: "성균관대입구" }];
    mockFindOne.mockResolvedValueOnce({
      _id: "cr_test2",
      data,
      _updatedAt: new Date(),
    });
    await busCache.findValue(key("cr_test2"));
    jest.clearAllMocks();

    // Act
    const result = await busCache.findValue(key("cr_test2"));

    // Assert
    expect(result).toEqual(data);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("caches null result when MongoDB has no document", async () => {
    // Arrange
    mockFindOne.mockResolvedValueOnce(null);
    const first = await busCache.findValue(key("cr_test3"));
    expect(first).toBeNull();
    jest.clearAllMocks();

    // Act
    const second = await busCache.findValue(key("cr_test3"));

    // Assert
    expect(second).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("re-queries after the in-mem TTL expires", async () => {
    // Arrange
    mockFindOne.mockResolvedValue({
      _id: "cr_ttl",
      data: [1],
      _updatedAt: new Date(),
    });
    let now = 1_000_000;
    jest.useFakeTimers({ now });

    try {
      // Act & Assert
      await busCache.findValue(key("cr_ttl"));
      expect(mockFindOne).toHaveBeenCalledTimes(1);

      // Within TTL → memory
      await busCache.findValue(key("cr_ttl"));
      expect(mockFindOne).toHaveBeenCalledTimes(1);

      // Advance past TTL → re-query
      now += 5001;
      jest.setSystemTime(now);
      await busCache.findValue(key("cr_ttl"));
      expect(mockFindOne).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
