/**
 * HolidaysService.holidayName over an in-memory repository (the typed fake in
 * __tests__/helpers/fakes/holidays/) and a fixed Clock. What it guards:
 *  - a stored year is answered from the calendar alone, its substitute,
 *    temporary and election-day holidays included;
 *  - a year with no stored document is answered by the rule-based lookup,
 *    with one warning naming the year per hour, not one per call;
 *  - a date the lookup cannot take (year 0) throws a RangeError, whether or
 *    not years are stored, and is not answered from rules.
 * How often the stored years are read is holidays.repository.spec.ts's, and
 * how they are written is the sync's (src/holidays/sync/).
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../infra/logger", () => mockLogger);

import { FakeHolidaysRepository } from "../../__tests__/helpers/fakes/holidays/holidays.repository.fake";
import { asReal } from "../../__tests__/helpers/fakes/public-of";
import { logText } from "../../__tests__/helpers/log-text";
import type { Clock } from "../infra/clock";
import type { HolidaysRepository } from "./holidays.repository";
import { HolidaysService } from "./holidays.service";
import type { PublicHoliday } from "./holidays.types";

const HOUR_MS = 60 * 60_000;
// 01:30 KST on 2026-10-17, still the 16th in UTC.
const NOW = new Date("2026-10-16T16:30:00Z");
const CALENDAR_2026: PublicHoliday[] = [
  { date: "2026-03-01", name: "삼일절" },
  { date: "2026-03-02", name: "대체공휴일(삼일절)" },
  { date: "2026-06-03", name: "전국동시지방선거" },
];

interface Setup {
  service: HolidaysService;
  advance: (ms: number) => void;
}

function setup(repository = new FakeHolidaysRepository()): Setup {
  let now = NOW.getTime();
  const clock = { now: () => new Date(now) };
  const service = new HolidaysService(asReal<HolidaysRepository>(repository), clock as Clock);
  return { service, advance: (ms) => (now += ms) };
}

const fallbackWarnings = () => mockLogger.warn.mock.calls.filter(([fields]) => fields?.event === "holidays.lookup.rules_fallback");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("HolidaysService.holidayName for a stored year", () => {
  it.each([
    ["Substitute holiday", "2026-03-02", "대체공휴일(삼일절)"],
    ["Election day", "2026-06-03", "전국동시지방선거"],
    ["an ordinary day", "2026-03-03", null],
  ])("%s: %s is answered from the calendar as %s", async (_label, date, name) => {
    // Arrange
    const { service } = setup(new FakeHolidaysRepository().store(2026, CALENDAR_2026));

    // Act & Assert
    await expect(service.holidayName(date)).resolves.toBe(name);
    expect(fallbackWarnings()).toHaveLength(0);
  });

  it("Temporary holiday: a day the calendar lists as 임시공휴일 is a holiday", async () => {
    // Arrange
    const { service } = setup(new FakeHolidaysRepository().store(2024, [{ date: "2024-10-01", name: "임시공휴일" }]));

    // Act & Assert
    await expect(service.holidayName("2024-10-01")).resolves.toBe("임시공휴일");
  });

  it("answers a day the rules call a holiday but the calendar does not list as no holiday", async () => {
    // Arrange
    const { service } = setup(new FakeHolidaysRepository().store(2026, CALENDAR_2026));

    // Act & Assert
    await expect(service.holidayName("2026-10-09")).resolves.toBeNull();
  });
});

describe("HolidaysService.holidayName for a year with no stored calendar", () => {
  it("Year not yet published: a rule-based substitute holiday is a holiday, and a warning names the year", async () => {
    // Arrange
    const { service } = setup(new FakeHolidaysRepository().store(2026, CALENDAR_2026));

    // Act
    const name = await service.holidayName("2029-05-07");

    // Assert
    expect(name).toBe("어린이날 (대체공휴일)");
    expect(fallbackWarnings()).toHaveLength(1);
    expect(fallbackWarnings()[0]![0]).toMatchObject({ event: "holidays.lookup.rules_fallback", year: 2029 });
    expect(logText(fallbackWarnings()[0])).toContain("2029");
  });

  it("warns once an hour per year, not once per lookup", async () => {
    // Arrange
    const { service, advance } = setup();
    await service.holidayName("2029-05-07");
    await service.holidayName("2029-05-08");
    await service.holidayName("2030-05-06");
    advance(HOUR_MS - 1);
    await service.holidayName("2029-05-07");
    const warnedYears = fallbackWarnings().map(([fields]) => fields.year);

    // Act
    advance(1);
    await service.holidayName("2029-05-07");

    // Assert
    expect(warnedYears).toEqual([2029, 2030]);
    expect(fallbackWarnings().map(([fields]) => fields.year)).toEqual([2029, 2030, 2029]);
  });
});

describe("HolidaysService.holidayName on a date the lookup cannot take", () => {
  it.each([
    ["no stored years", new FakeHolidaysRepository()],
    ["a stored year", new FakeHolidaysRepository().store(2026, CALENDAR_2026)],
  ])("Invalid year: year 0 throws a RangeError with %s, and is not answered from rules", async (_label, repository) => {
    // Arrange
    const { service } = setup(repository);

    // Act & Assert
    await expect(service.holidayName("0000-01-03")).rejects.toThrow(new RangeError("0000-01-03 is not a date from 1900 to 2999"));
    expect(fallbackWarnings()).toHaveLength(0);
  });

  it("throws a RangeError on a day that does not exist in a stored year", async () => {
    // Arrange
    const { service } = setup(new FakeHolidaysRepository().store(2026, CALENDAR_2026));

    // Act & Assert
    await expect(service.holidayName("2026-02-29")).rejects.toThrow(RangeError);
  });
});
