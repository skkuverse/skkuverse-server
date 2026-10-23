/**
 * CalendarHolidaySyncService.run() over a scripted client, in-memory repositories
 * (the typed fakes in __tests__/helpers/fakes/calendar/) and a fixed Clock.
 * What it guards: a run fetches the KST year and the next, skipping a year
 * stored under 24 hours ago (the poller ticks hourly, so a failed year is
 * retried within the hour and a stored one refetched once a day), stores each
 * with the Clock's time, stores nothing for a year the calendar has not published,
 * keeps the stored years and still stores the other year when one fails, then
 * rejects so the poller reports failing; every run clears the read side's
 * cache, so a lookup in this process sees what it wrote. The payload
 * translation is calendar-holiday-sync.client.spec.ts's and the exact MongoDB write
 * calendar-holiday-sync.repository.spec.ts's.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { FakeCalendarRepository } from "../../../__tests__/helpers/fakes/calendar/calendar.repository.fake";
import { FakeCalendarHolidaySyncClient } from "../../../__tests__/helpers/fakes/calendar/calendar-holiday-sync.client.fake";
import { FakeCalendarHolidaySyncRepository } from "../../../__tests__/helpers/fakes/calendar/calendar-holiday-sync.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import type { CalendarRepository } from "../calendar.repository";
import type { PublicHoliday } from "../calendar.types";
import type { CalendarHolidaySyncClient } from "./calendar-holiday-sync.client";
import type { CalendarHolidaySyncRepository } from "./calendar-holiday-sync.repository";
import { CalendarHolidaySyncService } from "./calendar-holiday-sync.service";

// 01:30 KST on 2026-10-17, still the 16th in UTC.
const NOW = new Date("2026-10-16T16:30:00Z");
const EARLIER = new Date("2026-10-01T00:00:00Z");
const HOUR_MS = 60 * 60_000;
const hoursBefore = (hours: number, ms = 0): Date => new Date(NOW.getTime() - hours * HOUR_MS - ms);
const CALENDAR_2026: PublicHoliday[] = [
  { date: "2026-03-02", name: "대체공휴일(삼일절)" },
  { date: "2026-06-03", name: "전국동시지방선거" },
];
const CALENDAR_2027: PublicHoliday[] = [{ date: "2027-01-01", name: "1월1일" }];

function setup() {
  const client = new FakeCalendarHolidaySyncClient();
  const repository = new FakeCalendarHolidaySyncRepository();
  const holidays = new FakeCalendarRepository();
  const clock = { now: () => NOW } as Clock;
  const service = new CalendarHolidaySyncService(
    asReal<CalendarHolidaySyncClient>(client),
    asReal<CalendarHolidaySyncRepository>(repository),
    asReal<CalendarRepository>(holidays),
    clock,
  );
  return { service, client, repository, holidays };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("CalendarHolidaySyncService.run", () => {
  it("fetches this KST year and the next, and stores each with the Clock's time", async () => {
    // Arrange
    const { service, client, repository } = setup();
    client.answers.set(2026, CALENDAR_2026).set(2027, CALENDAR_2027);

    // Act
    await service.run();

    // Assert
    expect(client.calls).toEqual([2026, 2027]);
    expect(repository.years.get(2026)).toEqual({ _id: 2026, holidays: CALENDAR_2026, fetchedAt: NOW });
    expect(repository.years.get(2027)).toEqual({ _id: 2027, holidays: CALENDAR_2027, fetchedAt: NOW });
  });

  it("stores nothing for a year the calendar has not published, so that year keeps its stored or rule-based answer", async () => {
    // Arrange
    const { service, client, repository } = setup();
    repository.years.set(2027, { _id: 2027, holidays: CALENDAR_2027, fetchedAt: EARLIER });
    client.answers.set(2026, CALENDAR_2026).set(2027, []);

    // Act
    await service.run();

    // Assert
    expect(repository.years.get(2027)).toEqual({ _id: 2027, holidays: CALENDAR_2027, fetchedAt: EARLIER });
    expect([...repository.years.keys()].sort()).toEqual([2026, 2027]);
  });

  it("Calendar unreachable: keeps the stored year, stores the year that answered, and rejects", async () => {
    // Arrange
    const unreachable = new Error("getRestDeInfo: 2026: HTTP 500");
    const { service, client, repository } = setup();
    repository.years.set(2026, { _id: 2026, holidays: CALENDAR_2026, fetchedAt: EARLIER });
    client.answers.set(2026, unreachable).set(2027, CALENDAR_2027);

    // Act
    const outcome = service.run();

    // Assert
    await expect(outcome).rejects.toBe(unreachable);
    expect(repository.years.get(2026)).toEqual({ _id: 2026, holidays: CALENDAR_2026, fetchedAt: EARLIER });
    expect(repository.years.get(2027)?.holidays).toEqual(CALENDAR_2027);
  });

  it("rejects naming both years when both fail", async () => {
    // Arrange
    const { service, client } = setup();
    client.answers.set(2026, new Error("2026 failed")).set(2027, new Error("2027 failed"));

    // Act
    const err = (await service.run().catch((e: unknown) => e)) as AggregateError;

    // Assert
    expect(err).toBeInstanceOf(AggregateError);
    expect(err.errors.map((e: Error) => e.message)).toEqual(["2026 failed", "2027 failed"]);
  });

  it.each([
    ["succeeds", CALENDAR_2026],
    ["fails", new Error("2026 failed")],
  ])("Temporary holiday declared next week: clears the read side's cache once when the run %s", async (_label, answer) => {
    // Arrange
    const { service, client, holidays } = setup();
    client.answers.set(2026, answer).set(2027, CALENDAR_2027);

    // Act
    await service.run().catch(() => undefined);

    // Assert
    expect(holidays.clears).toBe(1);
  });
});

describe("CalendarHolidaySyncService.run on the hourly tick", () => {
  it("fetches nothing and resolves when every sync year was stored under 24 hours ago", async () => {
    // Arrange
    const { service, client, repository, holidays } = setup();
    holidays.store(2026, CALENDAR_2026, hoursBefore(1)).store(2027, CALENDAR_2027, hoursBefore(23, 59 * 60_000));
    client.answers.set(2026, new Error("2026 failed")).set(2027, new Error("2027 failed"));

    // Act
    const outcome = service.run();

    // Assert
    await expect(outcome).resolves.toBeUndefined();
    expect(client.calls).toEqual([]);
    expect(repository.years.size).toBe(0);
  });

  it("fetches a sync year stored exactly 24 hours ago, and one never stored", async () => {
    // Arrange
    const { service, client, repository, holidays } = setup();
    holidays.store(2026, CALENDAR_2026, hoursBefore(24));
    client.answers.set(2026, CALENDAR_2026).set(2027, CALENDAR_2027);

    // Act
    await service.run();

    // Assert
    expect(client.calls).toEqual([2026, 2027]);
    expect(repository.years.get(2026)?.fetchedAt).toEqual(NOW);
    expect(repository.years.get(2027)?.fetchedAt).toEqual(NOW);
  });

  it("Last sync refused: fetches only the stale year and leaves the fresh one alone", async () => {
    // Arrange
    const { service, client, repository, holidays } = setup();
    holidays.store(2026, CALENDAR_2026, hoursBefore(2)).store(2027, CALENDAR_2027, hoursBefore(25));
    client.answers.set(2026, CALENDAR_2026).set(2027, CALENDAR_2027);

    // Act
    await service.run();

    // Assert
    expect(client.calls).toEqual([2027]);
    expect([...repository.years.keys()]).toEqual([2027]);
    expect(repository.years.get(2027)).toEqual({ _id: 2027, holidays: CALENDAR_2027, fetchedAt: NOW });
  });

  it("ignores a stored year outside the sync years", async () => {
    // Arrange
    const { service, client, holidays } = setup();
    holidays.store(2025, [], hoursBefore(1));
    client.answers.set(2026, CALENDAR_2026).set(2027, CALENDAR_2027);

    // Act
    await service.run();

    // Assert
    expect(client.calls).toEqual([2026, 2027]);
  });

  it("rejects without fetching when the stored years cannot be read", async () => {
    // Arrange
    const unreadable = new Error("server selection timed out");
    const { service, client, holidays } = setup();
    holidays.failWith = unreadable;

    // Act
    const outcome = service.run();

    // Assert
    await expect(outcome).rejects.toBe(unreadable);
    expect(client.calls).toEqual([]);
  });
});
