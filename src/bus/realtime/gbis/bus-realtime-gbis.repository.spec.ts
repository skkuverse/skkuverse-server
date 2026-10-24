/**
 * BusRealtimeGbisRepository over a mocked Mongo seam (src/infra/db): a route's seats replace its one `bus_seats`
 * document, keyed by the route id, and the read finds that document by id under the hot-read time bound, behind a
 * 5 s in-memory layer per route (a memory hit, a cached null, a re-read after the TTL). It ensures no index.
 */
const mockReplaceOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
const mockFindOne = jest.fn();
const mockCreateIndex = jest.fn();
const mockCollection = jest.fn().mockReturnValue({ replaceOne: mockReplaceOne, findOne: mockFindOne, createIndex: mockCreateIndex });

jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: 3_000,
  getClient: jest.fn().mockReturnValue({ db: jest.fn().mockReturnValue({ collection: mockCollection }) }),
}));

import { BusRealtimeGbisRepository } from "./bus-realtime-gbis.repository";
import type { BusSeatsDocument } from "./bus-realtime-gbis.document";

const SEATS: BusSeatsDocument = {
  _id: "gyeonggi7800",
  seats: [
    { vehicleId: "200010839", seatsLeft: 41 },
    { vehicleId: "200011531", seatsLeft: null },
  ],
  checkedAt: new Date("2026-10-24T11:22:50.000Z"),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusRealtimeGbisRepository.upsertSeats", () => {
  it("replaces the route's one bus_seats document, inserting it the first time", async () => {
    // Act
    await new BusRealtimeGbisRepository().upsertSeats(SEATS);

    // Assert
    expect(mockCollection).toHaveBeenCalledWith("bus_seats");
    expect(mockReplaceOne).toHaveBeenCalledWith({ _id: "gyeonggi7800" }, SEATS, { upsert: true });
  });

  it("rejects when the write fails", async () => {
    // Arrange
    mockReplaceOne.mockRejectedValueOnce(new Error("atlas down"));

    // Act & Assert
    await expect(new BusRealtimeGbisRepository().upsertSeats(SEATS)).rejects.toThrow("atlas down");
  });
});

describe("BusRealtimeGbisRepository.findSeats", () => {
  it("finds the route's document by id under the hot-read time bound", async () => {
    // Arrange
    mockFindOne.mockResolvedValueOnce(SEATS);

    // Act
    const found = await new BusRealtimeGbisRepository().findSeats("gyeonggi7800");

    // Assert
    expect(found).toEqual(SEATS);
    expect(mockCollection).toHaveBeenCalledWith("bus_seats");
    expect(mockFindOne).toHaveBeenCalledWith({ _id: "gyeonggi7800" }, { maxTimeMS: 3_000 });
  });

  it("answers null for a route with no document, and caches that for 5 s", async () => {
    // Arrange
    jest.useFakeTimers({ now: new Date("2026-10-24T11:00:00Z") });
    mockFindOne.mockResolvedValue(null);
    const repository = new BusRealtimeGbisRepository();

    // Act
    let reads: Array<BusSeatsDocument | null>;
    try {
      reads = [await repository.findSeats("gyeonggi7800"), await repository.findSeats("gyeonggi7800")];
      jest.setSystemTime(new Date("2026-10-24T11:00:05.001Z"));
      reads.push(await repository.findSeats("gyeonggi7800"));
    } finally {
      jest.useRealTimers();
    }

    // Assert
    expect(reads).toEqual([null, null, null]);
    expect(mockFindOne).toHaveBeenCalledTimes(2);
  });

  it("keeps one memory per route", async () => {
    // Arrange
    mockFindOne.mockResolvedValue(SEATS);
    const repository = new BusRealtimeGbisRepository();

    // Act
    await repository.findSeats("gyeonggi7800");
    await repository.findSeats("gyeonggi9999");

    // Assert
    expect(mockFindOne.mock.calls.map(([filter]) => filter)).toEqual([{ _id: "gyeonggi7800" }, { _id: "gyeonggi9999" }]);
  });
});
