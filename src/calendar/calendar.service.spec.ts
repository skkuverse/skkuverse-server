/**
 * CalendarService over an in-memory repository (the typed fake in
 * __tests__/helpers/fakes/calendar/) and a fixed Clock. What it guards:
 *  - publicHolidayName: a stored year is answered from the calendar alone,
 *    its substitute, temporary and election-day holidays included; a year
 *    with no stored document is answered by the rule-based lookup, with one
 *    warning naming the year per hour, not one per call; a date the lookup
 *    cannot take (year 0) throws a RangeError, whether or not years are
 *    stored, and is not answered from rules.
 *  - dayOf: a date's public holiday and school rest day, the rest day from
 *    the `skku-rest-days` dataset (an exact date before a yearly one), read
 *    as every dataset is (ADR 0013, D6): cached for DATASET_CACHE_TTL_MS,
 *    kept through an invalid reload, and CALENDAR_UNAVAILABLE (503) when no
 *    good revision was ever read; the RangeError comes first, even on a rest
 *    day.
 *  - revisionKey: changes with the rest days' revision.
 * How often the stored years are read is calendar.repository.spec.ts's, and
 * how they are written is the sync's (src/calendar/holiday-sync/).
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake
 * system time.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../infra/logger", () => mockLogger);

import { FakeCalendarRepository } from "../../__tests__/helpers/fakes/calendar/calendar.repository.fake";
import { restDaysFixture, storedCalendarRepository } from "../../__tests__/helpers/calendar/rest-days";
import { asReal } from "../../__tests__/helpers/fakes/public-of";
import { logText } from "../../__tests__/helpers/log-text";
import type { Clock } from "../infra/clock";
import type { CalendarRepository } from "./calendar.repository";
import { CalendarService } from "./calendar.service";
import { DATASET_CACHE_TTL_MS } from "../shared/dataset.constants";
import type { PublicHoliday } from "./calendar.types";

const HOUR_MS = 60 * 60_000;
// 01:30 KST on 2026-10-17, still the 16th in UTC.
const NOW = new Date("2026-10-16T16:30:00Z");
const CALENDAR_2026: PublicHoliday[] = [
  { date: "2026-03-01", name: "삼일절" },
  { date: "2026-03-02", name: "대체공휴일(삼일절)" },
  { date: "2026-06-03", name: "전국동시지방선거" },
];

interface Setup {
  service: CalendarService;
  advance: (ms: number) => void;
}

function setup(repository = new FakeCalendarRepository()): Setup {
  let now = NOW.getTime();
  const clock = { now: () => new Date(now) };
  const service = new CalendarService(asReal<CalendarRepository>(repository), clock as Clock);
  return { service, advance: (ms) => (now += ms) };
}

const fallbackWarnings = () => mockLogger.warn.mock.calls.filter(([fields]) => fields?.event === "holidays.lookup.rules_fallback");

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("CalendarService.publicHolidayName for a stored year", () => {
  it.each([
    ["Substitute holiday", "2026-03-02", "대체공휴일(삼일절)"],
    ["Election day", "2026-06-03", "전국동시지방선거"],
    ["an ordinary day", "2026-03-03", null],
  ])("%s: %s is answered from the calendar as %s", async (_label, date, name) => {
    // Arrange
    const { service } = setup(new FakeCalendarRepository().store(2026, CALENDAR_2026));

    // Act & Assert
    await expect(service.publicHolidayName(date)).resolves.toBe(name);
    expect(fallbackWarnings()).toHaveLength(0);
  });

  it("Temporary holiday: a day the calendar lists as 임시공휴일 is a holiday", async () => {
    // Arrange
    const { service } = setup(new FakeCalendarRepository().store(2024, [{ date: "2024-10-01", name: "임시공휴일" }]));

    // Act & Assert
    await expect(service.publicHolidayName("2024-10-01")).resolves.toBe("임시공휴일");
  });

  it("answers a day the rules call a holiday but the calendar does not list as no holiday", async () => {
    // Arrange
    const { service } = setup(new FakeCalendarRepository().store(2026, CALENDAR_2026));

    // Act & Assert
    await expect(service.publicHolidayName("2026-10-09")).resolves.toBeNull();
  });
});

describe("CalendarService.publicHolidayName for a year with no stored calendar", () => {
  it("Year not yet published: a rule-based substitute holiday is a holiday, and a warning names the year", async () => {
    // Arrange
    const { service } = setup(new FakeCalendarRepository().store(2026, CALENDAR_2026));

    // Act
    const name = await service.publicHolidayName("2029-05-07");

    // Assert
    expect(name).toBe("어린이날 (대체공휴일)");
    expect(fallbackWarnings()).toHaveLength(1);
    expect(fallbackWarnings()[0]![0]).toMatchObject({ event: "holidays.lookup.rules_fallback", year: 2029 });
    expect(logText(fallbackWarnings()[0])).toContain("2029");
  });

  it("warns once an hour per year, not once per lookup", async () => {
    // Arrange
    const { service, advance } = setup();
    await service.publicHolidayName("2029-05-07");
    await service.publicHolidayName("2029-05-08");
    await service.publicHolidayName("2030-05-06");
    advance(HOUR_MS - 1);
    await service.publicHolidayName("2029-05-07");
    const warnedYears = fallbackWarnings().map(([fields]) => fields.year);

    // Act
    advance(1);
    await service.publicHolidayName("2029-05-07");

    // Assert
    expect(warnedYears).toEqual([2029, 2030]);
    expect(fallbackWarnings().map(([fields]) => fields.year)).toEqual([2029, 2030, 2029]);
  });
});

describe("CalendarService.publicHolidayName on a date the lookup cannot take", () => {
  it.each([
    ["no stored years", new FakeCalendarRepository()],
    ["a stored year", new FakeCalendarRepository().store(2026, CALENDAR_2026)],
  ])("Invalid year: year 0 throws a RangeError with %s, and is not answered from rules", async (_label, repository) => {
    // Arrange
    const { service } = setup(repository);

    // Act & Assert
    await expect(service.publicHolidayName("0000-01-03")).rejects.toThrow(new RangeError("0000-01-03 is not a date from 1900 to 2999"));
    expect(fallbackWarnings()).toHaveLength(0);
  });

  it("throws a RangeError on a day that does not exist in a stored year", async () => {
    // Arrange
    const { service } = setup(new FakeCalendarRepository().store(2026, CALENDAR_2026));

    // Act & Assert
    await expect(service.publicHolidayName("2026-02-29")).rejects.toThrow(RangeError);
  });
});

describe("CalendarService.dayOf", () => {
  it("answers a date's public holiday and school rest day", async () => {
    // Arrange
    const { service } = setup(storedCalendarRepository().store(2026, [...CALENDAR_2026, { date: "2026-09-28", name: "임시공휴일" }]));

    // Act & Assert
    await expect(service.dayOf("2026-09-28")).resolves.toEqual({ date: "2026-09-28", publicHoliday: "임시공휴일", schoolRestDay: "공자탄신일" });
    await expect(service.dayOf("2026-03-02")).resolves.toEqual({ date: "2026-03-02", publicHoliday: "대체공휴일(삼일절)", schoolRestDay: null });
    await expect(service.dayOf("2026-03-03")).resolves.toEqual({ date: "2026-03-03", publicHoliday: null, schoolRestDay: null });
  });

  it("answers an exact rest day before the yearly one on its date", async () => {
    // Arrange
    const repository = new FakeCalendarRepository().store(2030, []);
    repository.storeRestDays({ ...restDaysFixture(), "2030-09-28": "공자탄신일 (특별)" });
    const { service } = setup(repository);

    // Act & Assert
    await expect(service.dayOf("2030-09-28")).resolves.toMatchObject({ schoolRestDay: "공자탄신일 (특별)" });
    await expect(service.dayOf("2031-09-28")).resolves.toMatchObject({ schoolRestDay: "공자탄신일" });
  });

  it("answers CALENDAR_UNAVAILABLE (503) while no rest days were ever read", async () => {
    // Arrange
    const { service } = setup(new FakeCalendarRepository());

    // Act & Assert
    await expect(service.dayOf("2026-09-28")).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE", httpStatus: 503 });
    await expect(service.revisionKey()).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE", httpStatus: 503 });
  });

  it("answers CALENDAR_UNAVAILABLE (503) on a first read that fails, logging the failure", async () => {
    // Arrange
    const repository = storedCalendarRepository();
    const failure = new Error("server selection timed out");
    repository.failRestDaysWith = failure;
    const { service } = setup(repository);

    // Act & Assert
    await expect(service.dayOf("2026-09-28")).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE", httpStatus: 503 });
    expect(mockLogger.error.mock.calls.filter(([fields]) => fields?.event === "calendar.rest_days.read_failed")).toEqual([
      [expect.objectContaining({ err: failure }), expect.any(String)],
    ]);
  });

  it("serves a rest days push once the TTL has passed, and keeps the last good one through an invalid push", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const repository = storedCalendarRepository().store(2027, []);
    const { service } = setup(repository);
    const before = await service.dayOf("2027-03-02");
    repository.storeRestDays({ ...restDaysFixture(), "2027-03-02": "학사휴교" });

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await service.dayOf("2027-03-02");
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const atTtl = await service.dayOf("2027-03-02");
    repository.storeRestDays({ ...restDaysFixture(), "02-30": "휴일" });
    jest.setSystemTime(NOW.getTime() + 2 * DATASET_CACHE_TTL_MS);
    const afterInvalid = await service.dayOf("2027-03-02");

    // Assert
    expect(before.schoolRestDay).toBeNull();
    expect(beforeTtl.schoolRestDay).toBeNull();
    expect(atTtl.schoolRestDay).toBe("학사휴교");
    expect(afterInvalid.schoolRestDay).toBe("학사휴교");
  });
});

// QUIRK(date-holidays): isHoliday never returns for an Invalid Date or a year-0 or year-1 day, and reads an
// impossible day (2026-02-29) as the next real one, so the day refuses those before asking it.
describe("CalendarService.dayOf on a date the holiday lookup cannot take", () => {
  it.each(["2026-13-01", "2026-02-31", "2026-02-29", "2026-04-31", "0000-01-03", "0001-01-01", "1899-12-31", "3000-01-01", "10000-01-01", "2026-1-01", "Invalid date"])(
    "throws on %s",
    async (date) => {
      // Arrange
      const { service } = setup(storedCalendarRepository());

      // Act & Assert
      await expect(service.dayOf(date)).rejects.toThrow(`${date} is not a date from 1900 to 2999`);
    },
  );

  it.each(["1900-01-01", "2999-12-31", "2028-02-29"])("answers %s", async (date) => {
    // Arrange
    const { service } = setup(storedCalendarRepository());

    // Act & Assert
    await expect(service.dayOf(date)).resolves.toMatchObject({ date, schoolRestDay: null });
  });

  it("refuses a year out of range even on a day the SKKU list names", async () => {
    // Arrange
    const { service } = setup(storedCalendarRepository());

    // Act & Assert
    await expect(service.dayOf("0001-09-28")).rejects.toThrow("0001-09-28 is not a date from 1900 to 2999");
  });
});

describe("CalendarService.revisionKey", () => {
  it("changes with the rest days' revision once the TTL has passed", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const repository = storedCalendarRepository();
    const { service } = setup(repository);
    const before = await service.revisionKey();
    repository.storeRestDays(restDaysFixture());

    // Act
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const after = await service.revisionKey();

    // Assert
    expect(after).not.toBe(before);
  });
});
