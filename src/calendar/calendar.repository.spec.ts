/**
 * CalendarRepository's reads.
 *
 * `public_holidays`, one document per year keyed by the year: every stored
 * year, projected and bounded (which FakeCalendarRepository follows), read at
 * most once every ten minutes and waiting for that read once the ten minutes
 * pass, served stale for a day when a reload fails, and read again after
 * clearPublicHolidaysCache(), which the holiday sync calls after writing. The
 * writes are calendar-holiday-sync.repository.spec.ts's.
 *
 * The `skku-rest-days` dataset, which `npm run data` writes and the server
 * only parses (ADR 0013, D6): one document by `_id`, projecting only the
 * revision and the data, bounded by `maxTimeMS`, on the content database's
 * `datasets`. A missing document and one that fails the schema both read as
 * `null`, each logged at error so a person looks, at most once a minute (an
 * invalid one once a minute per revision): the service then serves its last
 * good rest days or a 503. A failed read rejects as CalendarReadError.
 *
 * `academic_calendars`, which skkuverse-crawler writes in its base database
 * (the notices database here) and the server only reads: every document,
 * projected to the fields the calendar uses and bounded, each parsed with
 * `academicCalendarDoc`; one that fails is left out and logged, so its year
 * falls back to the rule. Cached like the stored years. The documents are the
 * crawler's own output (fixtures/academic-calendars.json of calendar).
 */
import fs from "fs";
import path from "path";

const toArray = jest.fn();
const find = jest.fn(() => ({ toArray }));
const findOne = jest.fn();
const mongoCollection = jest.fn(() => ({ find, findOne }));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../infra/logger", () => mockLogger);
jest.mock("../infra/mongo", () => ({
  ...jest.requireActual("../infra/mongo"),
  mongoCollection: (...args: unknown[]) => mongoCollection(...(args as [])),
}));

import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { logText } from "../../__tests__/helpers/log-text";
import { CalendarRepository } from "./calendar.repository";

// A copy of revision 1 of the skku-rest-days dataset as stored on 2026-10-19.
const REST_DAYS_FIXTURE = path.join(__dirname, "../../__tests__/nest/calendar/fixtures/skku-rest-days.dataset.json");
const REST_DAYS = JSON.parse(fs.readFileSync(REST_DAYS_FIXTURE, "utf8")) as Record<string, string>;
delete REST_DAYS._about;

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

let repository: CalendarRepository;

beforeEach(() => {
  jest.clearAllMocks();
  // The cached loader reads Date.now; only the clock is faked, never the promise queue.
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
  toArray.mockResolvedValue([YEAR_2026]);
  findOne.mockReset();
  repository = new CalendarRepository();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("CalendarRepository.listPublicHolidayYears", () => {
  it("reads every stored year from public_holidays, projected and bounded", async () => {
    // Act
    const years = await repository.listPublicHolidayYears();

    // Assert
    expect(years).toEqual([YEAR_2026]);
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "public_holidays");
    expect(find).toHaveBeenCalledWith({}, { projection: { _id: 1, holidays: 1, fetchedAt: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("reads once every ten minutes, not once per call", async () => {
    // Arrange
    await repository.listPublicHolidayYears();
    jest.advanceTimersByTime(TEN_MINUTES_MS - 1);
    await repository.listPublicHolidayYears();
    const readsWithinTenMinutes = find.mock.calls.length;

    // Act
    jest.advanceTimersByTime(1);
    await repository.listPublicHolidayYears();

    // Assert
    expect(readsWithinTenMinutes).toBe(1);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("sees a holiday the poller stored ten minutes later (ADR 0012, D6)", async () => {
    // Arrange
    await repository.listPublicHolidayYears();
    const announced = { ...YEAR_2026, holidays: [...YEAR_2026.holidays, { date: "2026-10-20", name: "임시공휴일" }] };
    toArray.mockResolvedValue([announced]);

    // Act
    jest.advanceTimersByTime(TEN_MINUTES_MS);
    const years = await repository.listPublicHolidayYears();

    // Assert
    expect(years).toEqual([announced]);
  });

  it("serves the last good years when a reload fails within the day", async () => {
    // Arrange
    await repository.listPublicHolidayYears();
    jest.advanceTimersByTime(HOUR_MS);
    toArray.mockRejectedValue(new Error("cluster unreachable"));

    // Act & Assert
    await expect(repository.listPublicHolidayYears()).resolves.toEqual([YEAR_2026]);
  });

  it("rejects when the first read fails, with nothing to serve", async () => {
    // Arrange
    toArray.mockRejectedValue(new Error("cluster unreachable"));

    // Act & Assert
    await expect(repository.listPublicHolidayYears()).rejects.toThrow("cluster unreachable");
  });
});

describe("CalendarRepository.clearPublicHolidaysCache", () => {
  it("makes the next listPublicHolidayYears read again within the hour, as after a sync", async () => {
    // Arrange
    await repository.listPublicHolidayYears();

    // Act
    repository.clearPublicHolidaysCache();
    await repository.listPublicHolidayYears();

    // Assert
    expect(find).toHaveBeenCalledTimes(2);
  });
});

describe("CalendarRepository.findRestDays", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "skku-rest-days", revision: 2, data: REST_DAYS });

    // Act
    await repository.findRestDays();

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.content.dbName, config.content.collections.datasets);
    expect(findOne).toHaveBeenCalledWith({ _id: "skku-rest-days" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the rest days, yearly and one-off", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "skku-rest-days", revision: 2, data: { ...REST_DAYS, "2027-03-02": "학사휴교" } });

    // Act
    const stored = await repository.findRestDays();

    // Assert
    expect(stored).toEqual({
      revision: 2,
      restDays: { exact: new Map([["2027-03-02", "학사휴교"]]), annual: new Map([["09-25", "건학기념일"], ["09-28", "공자탄신일"]]) },
    });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await repository.findRestDays();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "calendar.rest_days.missing", dataset: "skku-rest-days" });
  });

  it("returns null for a document that fails the schema, logged at error with its revision and the key", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "skku-rest-days", revision: 3, data: { ...REST_DAYS, "02-30": "휴일" } });

    // Act
    const stored = await repository.findRestDays();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "calendar.rest_days.invalid", revision: 3 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.02-30: /);
  });

  it("logs a missing dataset at most once a minute, then with the lines it held back", async () => {
    // Arrange
    findOne.mockResolvedValue(null);
    await repository.findRestDays();
    await repository.findRestDays();
    jest.advanceTimersByTime(60_000);

    // Act
    await repository.findRestDays();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields.suppressed)).toEqual([0, 1]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "skku-rest-days", revision: 3, data: { "02-30": "휴일" } });
    await repository.findRestDays();
    await repository.findRestDays();
    findOne.mockResolvedValue({ _id: "skku-rest-days", revision: 4, data: { "02-31": "휴일" } });

    // Act
    await repository.findRestDays();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields.revision)).toEqual([3, 4]);
  });

  it("rejects a failing read as CalendarReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(repository.findRestDays()).rejects.toMatchObject({ name: "CalendarReadError", cause: failure });
  });
});

describe("CalendarRepository.listAcademicYears", () => {
  const ACADEMIC = JSON.parse(fs.readFileSync(path.join(__dirname, "../../__tests__/nest/calendar/fixtures/academic-calendars.json"), "utf8")) as Record<
    string,
    Record<string, unknown>
  >;
  const { _id, year, contentHash, semesters, restDays } = ACADEMIC["2026"]!;
  const YEAR_2026_READ = { _id, year, contentHash, semesters, restDays };

  beforeEach(() => {
    toArray.mockResolvedValue([YEAR_2026_READ]);
  });

  it("reads every crawled year from academic_calendars in the crawler's database, projected and bounded", async () => {
    // Act
    const years = await repository.listAcademicYears();

    // Assert
    expect(years).toEqual([YEAR_2026_READ]);
    expect(mongoCollection).toHaveBeenCalledWith(config.notices.dbName, "academic_calendars");
    expect(find).toHaveBeenCalledWith({}, { projection: { _id: 1, year: 1, contentHash: 1, semesters: 1, restDays: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("leaves out and logs a document that is not the shape the crawler writes, keeping the others", async () => {
    // Arrange
    toArray.mockResolvedValue([{ ...YEAR_2026_READ, _id: "2025" }, YEAR_2026_READ]);

    // Act
    const years = await repository.listAcademicYears();

    // Assert
    expect(years).toEqual([YEAR_2026_READ]);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "academic_calendar.invalid_document", invalid: ["2025: _id"] });
  });

  it("reads once every ten minutes, and serves the last good years when a reload fails within the day", async () => {
    // Arrange
    await repository.listAcademicYears();
    jest.advanceTimersByTime(TEN_MINUTES_MS - 1);
    await repository.listAcademicYears();
    const readsWithinTenMinutes = find.mock.calls.length;
    toArray.mockRejectedValue(new Error("cluster unreachable"));

    // Act
    jest.advanceTimersByTime(HOUR_MS);
    const years = await repository.listAcademicYears();

    // Assert
    expect(readsWithinTenMinutes).toBe(1);
    expect(find).toHaveBeenCalledTimes(2);
    expect(years).toEqual([YEAR_2026_READ]);
  });
});
