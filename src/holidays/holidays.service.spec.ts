/**
 * HolidaysService over a scripted client, an in-memory repository (the typed
 * fakes in __tests__/helpers/fakes/holidays/) and a fixed Clock. What it
 * guards:
 *  - holidayName answers a stored year from the calendar alone, its
 *    substitute, temporary and election-day holidays included, reading the
 *    stored years at most once an hour;
 *  - a year with no stored document is answered by the rule-based lookup,
 *    with one warning naming the year per hour, not one per call;
 *  - a date the lookup cannot take (year 0) throws a RangeError, whether or
 *    not years are stored, and is not answered from rules;
 *  - sync fetches the KST year and the next, stores each with the Clock's
 *    time, stores nothing for a year the calendar has not published, keeps
 *    the stored years and still stores the other year when one fails, then
 *    rejects so the poller reports failing; a lookup after a sync sees it.
 * The payload translation is holidays.client.spec.ts's and the exact MongoDB
 * calls are holidays.repository.spec.ts's.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../infra/logger", () => mockLogger);

import { FakeHolidaysClient } from "../../__tests__/helpers/fakes/holidays/holidays.client.fake";
import { FakeHolidaysRepository } from "../../__tests__/helpers/fakes/holidays/holidays.repository.fake";
import { asReal } from "../../__tests__/helpers/fakes/public-of";
import { logText } from "../../__tests__/helpers/log-text";
import type { Clock } from "../infra/clock";
import type { HolidaysClient } from "./holidays.client";
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
const CALENDAR_2027: PublicHoliday[] = [{ date: "2027-01-01", name: "1월1일" }];

interface Setup {
  service: HolidaysService;
  client: FakeHolidaysClient;
  repository: FakeHolidaysRepository;
  advance: (ms: number) => void;
}

function setup(repository = new FakeHolidaysRepository()): Setup {
  let now = NOW.getTime();
  const clock = { now: () => new Date(now) };
  const client = new FakeHolidaysClient();
  const service = new HolidaysService(asReal<HolidaysClient>(client), asReal<HolidaysRepository>(repository), clock as Clock);
  const advance = (ms: number): void => {
    now += ms;
    jest.setSystemTime(now);
  };
  return { service, client, repository, advance };
}

const fallbackWarnings = () => mockLogger.warn.mock.calls.filter(([fields]) => fields?.event === "holidays.lookup.rules_fallback");

beforeEach(() => {
  jest.clearAllMocks();
  // The cached loader reads Date.now; only the clock is faked, never the promise queue.
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
});

afterEach(() => {
  jest.useRealTimers();
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

  it("answers a day the rules call a holiday but the calendar does not list as no holiday", async () => {
    // Arrange
    const { service } = setup(new FakeHolidaysRepository().store(2026, CALENDAR_2026));

    // Act & Assert
    await expect(service.holidayName("2026-10-09")).resolves.toBeNull();
  });

  it("reads the stored years once an hour, not once per lookup", async () => {
    // Arrange
    const { service, repository, advance } = setup(new FakeHolidaysRepository().store(2026, CALENDAR_2026));
    await service.holidayName("2026-03-02");
    await service.holidayName("2026-06-03");
    advance(HOUR_MS - 1);
    await service.holidayName("2026-06-03");
    const readsWithinTheHour = repository.reads;

    // Act
    advance(1);
    await service.holidayName("2026-06-03");

    // Assert
    expect(readsWithinTheHour).toBe(1);
    expect(repository.reads).toBe(2);
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

describe("HolidaysService.sync", () => {
  it("fetches this KST year and the next, and stores each with the Clock's time", async () => {
    // Arrange
    const { service, client, repository } = setup();
    client.answers.set(2026, CALENDAR_2026).set(2027, CALENDAR_2027);

    // Act
    await service.sync();

    // Assert
    expect(client.calls).toEqual([2026, 2027]);
    expect(repository.years.get(2026)).toEqual({ _id: 2026, holidays: CALENDAR_2026, fetchedAt: NOW });
    expect(repository.years.get(2027)).toEqual({ _id: 2027, holidays: CALENDAR_2027, fetchedAt: NOW });
  });

  it("stores nothing for a year the calendar has not published, so that year keeps its stored or rule-based answer", async () => {
    // Arrange
    const stored = new FakeHolidaysRepository().store(2027, CALENDAR_2027, new Date("2026-10-01T00:00:00Z"));
    const { service, client, repository } = setup(stored);
    client.answers.set(2026, CALENDAR_2026).set(2027, []);

    // Act
    await service.sync();

    // Assert
    expect(repository.years.get(2027)).toEqual({ _id: 2027, holidays: CALENDAR_2027, fetchedAt: new Date("2026-10-01T00:00:00Z") });
    expect([...repository.years.keys()].sort()).toEqual([2026, 2027]);
  });

  it("Calendar unreachable: keeps the stored years serving, stores the year that answered, and rejects", async () => {
    // Arrange
    const unreachable = new Error("getRestDeInfo: 2026: HTTP 500");
    const { service, client, repository } = setup(new FakeHolidaysRepository().store(2026, CALENDAR_2026));
    client.answers.set(2026, unreachable).set(2027, CALENDAR_2027);

    // Act
    const outcome = service.sync();

    // Assert
    await expect(outcome).rejects.toBe(unreachable);
    expect(repository.years.get(2026)?.holidays).toEqual(CALENDAR_2026);
    expect(repository.years.get(2027)?.holidays).toEqual(CALENDAR_2027);
    await expect(service.holidayName("2026-06-03")).resolves.toBe("전국동시지방선거");
  });

  it("rejects naming both years when both fail", async () => {
    // Arrange
    const { service, client } = setup();
    client.answers.set(2026, new Error("2026 failed")).set(2027, new Error("2027 failed"));

    // Act
    const err = (await service.sync().catch((e: unknown) => e)) as AggregateError;

    // Assert
    expect(err).toBeInstanceOf(AggregateError);
    expect(err.errors.map((e: Error) => e.message)).toEqual(["2026 failed", "2027 failed"]);
  });

  it("Temporary holiday declared next week: a lookup after the sync answers it, without waiting for the hour", async () => {
    // Arrange
    const { service, client } = setup(new FakeHolidaysRepository().store(2026, CALENDAR_2026));
    await expect(service.holidayName("2026-10-23")).resolves.toBeNull();
    client.answers.set(2026, [...CALENDAR_2026, { date: "2026-10-23", name: "임시공휴일" }]).set(2027, CALENDAR_2027);

    // Act
    await service.sync();

    // Assert
    await expect(service.holidayName("2026-10-23")).resolves.toBe("임시공휴일");
  });
});
