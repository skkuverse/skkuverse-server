/**
 * HolidaysSyncService.run() over a scripted client, in-memory repositories
 * (the typed fakes in __tests__/helpers/fakes/holidays/) and a fixed Clock.
 * What it guards: a run fetches the KST year and the next, stores each with
 * the Clock's time, stores nothing for a year the calendar has not published,
 * keeps the stored years and still stores the other year when one fails, then
 * rejects so the poller reports failing; every run clears the read side's
 * cache, so a lookup in this process sees what it wrote. The payload
 * translation is holidays-sync.client.spec.ts's and the exact MongoDB write
 * holidays-sync.repository.spec.ts's.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { FakeHolidaysRepository } from "../../../__tests__/helpers/fakes/holidays/holidays.repository.fake";
import { FakeHolidaysSyncClient } from "../../../__tests__/helpers/fakes/holidays/holidays-sync.client.fake";
import { FakeHolidaysSyncRepository } from "../../../__tests__/helpers/fakes/holidays/holidays-sync.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import type { HolidaysRepository } from "../holidays.repository";
import type { PublicHoliday } from "../holidays.types";
import type { HolidaysSyncClient } from "./holidays-sync.client";
import type { HolidaysSyncRepository } from "./holidays-sync.repository";
import { HolidaysSyncService } from "./holidays-sync.service";

// 01:30 KST on 2026-10-17, still the 16th in UTC.
const NOW = new Date("2026-10-16T16:30:00Z");
const EARLIER = new Date("2026-10-01T00:00:00Z");
const CALENDAR_2026: PublicHoliday[] = [
  { date: "2026-03-02", name: "대체공휴일(삼일절)" },
  { date: "2026-06-03", name: "전국동시지방선거" },
];
const CALENDAR_2027: PublicHoliday[] = [{ date: "2027-01-01", name: "1월1일" }];

function setup() {
  const client = new FakeHolidaysSyncClient();
  const repository = new FakeHolidaysSyncRepository();
  const holidays = new FakeHolidaysRepository();
  const clock = { now: () => NOW } as Clock;
  const service = new HolidaysSyncService(
    asReal<HolidaysSyncClient>(client),
    asReal<HolidaysSyncRepository>(repository),
    asReal<HolidaysRepository>(holidays),
    clock,
  );
  return { service, client, repository, holidays };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("HolidaysSyncService.run", () => {
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
