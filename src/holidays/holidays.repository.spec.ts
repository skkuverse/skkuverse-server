/**
 * HolidaysRepository's read of `public_holidays`, one document per year keyed
 * by the year: every stored year, projected and bounded (which
 * FakeHolidaysRepository follows), read at most once every ten minutes and
 * waiting for that read once the ten minutes pass, served stale for a day when
 * a reload fails, and read again after clearCache(), which the
 * holiday sync calls after writing. The writes are
 * holidays-sync.repository.spec.ts's.
 */
const toArray = jest.fn();
const find = jest.fn(() => ({ toArray }));
const mongoCollection = jest.fn(() => ({ find }));

jest.mock("../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../infra/mongo", () => ({
  ...jest.requireActual("../infra/mongo"),
  mongoCollection: (...args: unknown[]) => mongoCollection(...(args as [])),
}));

import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { HolidaysRepository } from "./holidays.repository";

const HOUR_MS = 60 * 60_000;
const TEN_MINUTES_MS = 10 * 60_000;
const NOW = new Date("2026-10-16T16:30:00Z");
const YEAR_2026 = {
  _id: 2026,
  holidays: [
    { date: "2026-03-02", name: "대체공휴일(삼일절)" },
    { date: "2026-06-03", name: "전국동시지방선거" },
  ],
  fetchedAt: new Date("2026-10-16T03:00:00Z"),
};

let repository: HolidaysRepository;

beforeEach(() => {
  jest.clearAllMocks();
  // The cached loader reads Date.now; only the clock is faked, never the promise queue.
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
  toArray.mockResolvedValue([YEAR_2026]);
  repository = new HolidaysRepository();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("HolidaysRepository.listYears", () => {
  it("reads every stored year from public_holidays, projected and bounded", async () => {
    // Act
    const years = await repository.listYears();

    // Assert
    expect(years).toEqual([YEAR_2026]);
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "public_holidays");
    expect(find).toHaveBeenCalledWith({}, { projection: { _id: 1, holidays: 1, fetchedAt: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("reads once every ten minutes, not once per call", async () => {
    // Arrange
    await repository.listYears();
    jest.advanceTimersByTime(TEN_MINUTES_MS - 1);
    await repository.listYears();
    const readsWithinTenMinutes = find.mock.calls.length;

    // Act
    jest.advanceTimersByTime(1);
    await repository.listYears();

    // Assert
    expect(readsWithinTenMinutes).toBe(1);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("sees a holiday the poller stored ten minutes later (ADR 0012, D6)", async () => {
    // Arrange
    await repository.listYears();
    const announced = { ...YEAR_2026, holidays: [...YEAR_2026.holidays, { date: "2026-10-20", name: "임시공휴일" }] };
    toArray.mockResolvedValue([announced]);

    // Act
    jest.advanceTimersByTime(TEN_MINUTES_MS);
    const years = await repository.listYears();

    // Assert
    expect(years).toEqual([announced]);
  });

  it("serves the last good years when a reload fails within the day", async () => {
    // Arrange
    await repository.listYears();
    jest.advanceTimersByTime(HOUR_MS);
    toArray.mockRejectedValue(new Error("cluster unreachable"));

    // Act & Assert
    await expect(repository.listYears()).resolves.toEqual([YEAR_2026]);
  });

  it("rejects when the first read fails, with nothing to serve", async () => {
    // Arrange
    toArray.mockRejectedValue(new Error("cluster unreachable"));

    // Act & Assert
    await expect(repository.listYears()).rejects.toThrow("cluster unreachable");
  });
});

describe("HolidaysRepository.clearCache", () => {
  it("makes the next listYears read again within the hour, as after a sync", async () => {
    // Arrange
    await repository.listYears();

    // Act
    repository.clearCache();
    await repository.listYears();

    // Assert
    expect(find).toHaveBeenCalledTimes(2);
  });
});
