/**
 * SubwayRepository over `subway_arrivals`, one document per station keyed by
 * its station id. What it guards: a tracking tick replaces each station's
 * document whole, upserting it, in one unordered bulk write; the read lists
 * every station's document, bounded, which FakeSubwayRepository follows; and
 * an api replica reads at most once per 2 s however many requests it serves.
 */
const toArray = jest.fn();
const find = jest.fn(() => ({ toArray }));
const bulkWrite = jest.fn();
const mongoCollection = jest.fn(() => ({ find, bulkWrite }));

jest.mock("../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../infra/mongo", () => ({
  ...jest.requireActual("../infra/mongo"),
  mongoCollection: (...args: unknown[]) => mongoCollection(...(args as [])),
}));

import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import type { SubwayArrivalsDoc } from "./subway.document";
import { SubwayRepository } from "./subway.repository";

const NOW = new Date("2026-10-16T12:00:00Z");
const HYEHWA: SubwayArrivalsDoc = {
  _id: "S1-4-420",
  generatedAt: NOW,
  serviceDate: "2026-10-16",
  directions: {
    up: [
      {
        trainNo: "4674",
        destination: "진접",
        express: false,
        arrivalAt: new Date("2026-10-16T12:02:30Z"),
        source: "live",
        isFirstTrain: false,
        position: { stationId: "S1-4-421", state: "departed" },
      },
    ],
    down: [],
  },
};

let repository: SubwayRepository;

beforeEach(() => {
  jest.clearAllMocks();
  // The cached loader reads Date.now; only the clock is faked, never the promise queue.
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
  toArray.mockResolvedValue([HYEHWA]);
  repository = new SubwayRepository();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("SubwayRepository.upsertArrivals", () => {
  it("replaces each station's document whole, upserting it, in one unordered bulk write", async () => {
    // Act
    await repository.upsertArrivals([HYEHWA]);

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "subway_arrivals");
    expect(bulkWrite).toHaveBeenCalledWith(
      [{ replaceOne: { filter: { _id: "S1-4-420" }, replacement: HYEHWA, upsert: true } }],
      { ordered: false },
    );
  });

  it("writes nothing for no document", async () => {
    // Act
    await repository.upsertArrivals([]);

    // Assert
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});

describe("SubwayRepository.listArrivals", () => {
  it("lists every station's document, bounded", async () => {
    // Act
    const docs = await repository.listArrivals();

    // Assert
    expect(docs).toEqual([HYEHWA]);
    expect(find).toHaveBeenCalledWith({}, { maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("reads once per 2 s, not once per call", async () => {
    // Arrange
    await repository.listArrivals();
    jest.advanceTimersByTime(1_999);
    await repository.listArrivals();
    const readsWithinTwoSeconds = find.mock.calls.length;

    // Act
    jest.advanceTimersByTime(1);
    await repository.listArrivals();

    // Assert
    expect(readsWithinTwoSeconds).toBe(1);
    expect(find).toHaveBeenCalledTimes(2);
  });
});
