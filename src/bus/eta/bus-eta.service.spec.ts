/**
 * BusEtaService over an in-memory store and a stub schedule: the runs it reads
 * from the resolved timetable (one date of a week, or the smart view's runs not
 * yet departed, none for a suspended service), and the stored documents it
 * drops when their stop count no longer fits their sequence. Over the real
 * BusScheduleService, a timetable another process writes reaches the runs one
 * week-cache TTL later, so the ETA pollers need no restart (ADR 0012, D6); the
 * schedule content the timetable folds in comes from an in-memory dataset
 * store, so a stored suspension or rest day plans no run and content never read rejects
 * the runs (bus-eta-live.service.spec.ts pins the tick that then rejects). A suspension
 * that starts on the smart view's opening day plans no run of the days after it either,
 * until the smart view leaves `suspended`.
 */
import { FakeBusEtaRepository } from "../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { restDaysFixture, serviceNoticesWithSuspension, storedScheduleContentRepository, storedScheduleContentService } from "../../../__tests__/helpers/bus/schedule-content";
import { FakeBusScheduleContentRepository } from "../../../__tests__/helpers/fakes/bus/bus-schedule-content.repository.fake";
import { FakeBusScheduleRepository } from "../../../__tests__/helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeHolidaysService } from "../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { HolidaysService } from "../../holidays/holidays.service";
import type { BusScheduleRepository } from "../schedule/bus-schedule.repository";
import { BusScheduleService } from "../schedule/bus-schedule.service";
import type { ScheduleDay, ScheduleEntry } from "../schedule/bus-schedule.wire";
import { BusStopsService } from "../stops/bus-stops.service";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import type { ShuttleEtaDoc } from "./bus-eta.document";
import type { BusEtaRepository } from "./bus-eta.repository";
import { BusEtaService } from "./bus-eta.service";
import type { EtaSequence } from "./bus-eta.types";

function day(date: string, schedule: ScheduleEntry[], display = "schedule"): ScheduleDay {
  return { date, dayOfWeek: 5, display, label: null, notices: [], schedule };
}
const entry = (time: string, routeType: string): ScheduleEntry => ({ time, routeType, busCount: 1, notes: null, stopTimes: [time, null, null] });
const SEQUENCE: EtaSequence = { serviceId: "campus-inja", routeType: "regular", stops: [{ lat: 37.5, lng: 127 }, { lat: 37.4, lng: 127 }, { lat: 37.3, lng: 127 }] };

const build = (schedule: Partial<BusScheduleService>, repository = new FakeBusEtaRepository()) =>
  new BusEtaService(asReal<BusEtaRepository>(repository), schedule as BusScheduleService, new BusStopsService(new SubwayStationsService()));

describe("BusEtaService runs", () => {
  const week = {
    serviceId: "campus-inja",
    requestedFrom: null,
    from: "2026-10-12",
    days: [day("2026-10-12", [entry("07:00", "regular"), entry("10:00", "regular")]), day("2026-10-13", [entry("07:00", "regular")])],
  };
  const schedule = {
    resolveWeek: jest.fn(async () => week),
    resolveSmartSchedule: jest.fn(async () => ({ ...week, status: "active" as const, selectedDate: "2026-10-12" })),
    isSuspendedOn: jest.fn(async () => false),
  };

  it("runsOn reads one date of the resolved week", async () => {
    // Act
    const runs = await build(schedule).runsOn(SEQUENCE, "2026-10-13");

    // Assert
    expect(runs.map((r) => `${r.date} ${r.time}`)).toEqual(["2026-10-13 07:00"]);
    expect(schedule.resolveWeek).toHaveBeenCalledWith("campus-inja", "2026-10-13");
  });

  it("upcomingRuns keeps the smart view's runs that have not left yet", async () => {
    // Arrange
    const now = new Date("2026-10-12T00:30:00.000Z"); // 09:30 KST

    // Act
    const runs = await build(schedule).upcomingRuns(SEQUENCE, now);

    // Assert
    expect(runs.map((r) => `${r.date} ${r.time}`)).toEqual(["2026-10-12 10:00", "2026-10-13 07:00"]);
  });

  it("upcomingRuns is empty for a suspended service", async () => {
    // Act
    const suspended = { resolveSmartSchedule: jest.fn(async () => ({ serviceId: "campus-inja", status: "suspended" as const, from: null, selectedDate: null, days: [] })) };

    // Assert
    expect(await build(suspended).upcomingRuns(SEQUENCE, new Date("2026-10-12T00:30:00.000Z"))).toEqual([]);
  });
});

describe("BusEtaService.listFitting", () => {
  it("drops stored documents whose stop count no longer fits their sequence", async () => {
    // Arrange
    const doc = (routeType: string, offsetsSec: number[]) =>
      ({ _id: `${routeType}-${offsetsSec.length}`, serviceId: "campus-inja", routeType, date: "2026-10-12", offsetsSec }) as ShuttleEtaDoc;
    const stale = doc("regular", [0, 4500, 4620]); // fetched while the sequence had three stops
    const fresh = doc("regular", [0, 4500]);
    const hakbu = doc("hakbu", [0, 4400]);
    const repository = new FakeBusEtaRepository();
    for (const d of [stale, fresh, hakbu]) repository.docs.set(d._id + d.offsetsSec.join(), d);

    // Act
    const read = jest.spyOn(repository, "listEstimates");

    // Assert
    await expect(build({}, repository).listFitting(["campus-inja"], ["2026-10-12"])).resolves.toEqual([fresh, hakbu]);
    expect(read).toHaveBeenCalledWith(["campus-inja"], ["2026-10-12"]);
  });
});

describe("BusEtaService.listFixedFitting", () => {
  it("reads the fixed values and drops one whose stop count no longer fits its sequence", async () => {
    // Arrange
    const now = new Date("2026-10-19T19:00:00.000Z");
    const fixed = (date: string, offsetsSec: number[]) =>
      ({
        _id: `campus-inja|regular|${date}|13:30|live`,
        kind: "live",
        serviceId: "campus-inja",
        routeType: "regular",
        date,
        time: "13:30",
        departAt: new Date(`${date}T04:30:00.000Z`),
        offsetsSec,
        source: "naver",
        fetchedAt: new Date(`${date}T04:30:30.000Z`),
        frozen: true,
        frozenAt: new Date(`${date}T04:30:30.000Z`),
        expiresAt: new Date(new Date(`${date}T04:30:00.000Z`).getTime() + 8 * 24 * 3600_000),
      }) as ShuttleEtaDoc;
    const fits = fixed("2026-10-13", [0, 4320]);
    // fixed while the sequence had three stops
    const stale = fixed("2026-10-12", [0, 4500, 4620]);
    const repository = new FakeBusEtaRepository();
    for (const d of [fits, stale]) repository.docs.set(d._id, d);

    // Act
    const read = await build({}, repository).listFixedFitting(["campus-inja"], ["2026-10-13", "2026-10-12"], now);

    // Assert
    expect(read).toEqual([{ _id: fits._id, serviceId: "campus-inja", routeType: "regular", date: "2026-10-13", time: "13:30", offsetsSec: [0, 4320] }]);
  });
});

describe("BusEtaService runs over the stored timetable", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("runsOn uses a timetable another process wrote once the week cache's 60 s TTL has passed", async () => {
    // Arrange
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    jest.setSystemTime(new Date("2026-03-09T00:00:00.000Z"));
    const stored = new FakeBusScheduleRepository();
    const pattern = (time: string) => [{ serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: [{ index: 1, time, routeType: "regular", busCount: 1, notes: null, stopTimes: [time, null, null] }] }];
    stored.patterns = pattern("08:00");
    const clock = { now: () => new Date() };
    const schedule = new BusScheduleService(asReal<BusScheduleRepository>(stored), asReal<HolidaysService>(new FakeHolidaysService()), storedScheduleContentService(clock), clock);
    const eta = build(schedule);
    await eta.runsOn(SEQUENCE, "2026-03-09");
    stored.patterns = pattern("09:30");

    // Act
    jest.advanceTimersByTime(59_000);
    const before = await eta.runsOn(SEQUENCE, "2026-03-09");
    jest.advanceTimersByTime(2_000);
    const after = await eta.runsOn(SEQUENCE, "2026-03-09");

    // Assert
    expect(before.map((r) => r.time)).toEqual(["08:00"]);
    expect(after.map((r) => r.time)).toEqual(["09:30"]);
  });
});

describe("BusEtaService runs over the stored schedule content (move-editorial-datasets D9)", () => {
  // Monday 2026-10-12, 09:30 KST: the 10:00 run is inside its live window.
  const NOW = new Date("2026-10-12T00:30:00.000Z");
  const clock = { now: () => NOW };
  const WEEKDAYS = [
    { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null, null] }] },
  ];
  function etaOver(content: FakeBusScheduleContentRepository): BusEtaService {
    const timetable = new FakeBusScheduleRepository();
    timetable.patterns = WEEKDAYS;
    const schedule = new BusScheduleService(asReal<BusScheduleRepository>(timetable), asReal<HolidaysService>(new FakeHolidaysService()), storedScheduleContentService(clock, content), clock);
    return build(schedule);
  }

  it("rejects runsOn and upcomingRuns with BUS_SCHEDULE_UNAVAILABLE while no schedule content was ever read", async () => {
    // Arrange
    const eta = etaOver(new FakeBusScheduleContentRepository());

    // Act & Assert
    await expect(eta.runsOn(SEQUENCE, "2026-10-12")).rejects.toMatchObject({ code: "BUS_SCHEDULE_UNAVAILABLE" });
    await expect(eta.upcomingRuns(SEQUENCE, NOW)).rejects.toMatchObject({ code: "BUS_SCHEDULE_UNAVAILABLE" });
  });

  it("plans no run on a day inside a stored suspension", async () => {
    // Arrange
    const suspended = storedScheduleContentRepository();
    suspended.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-10-12", until: "2026-10-16" }));
    const eta = etaOver(suspended);

    // Act
    const runs = await eta.runsOn(SEQUENCE, "2026-10-12");
    const upcoming = await eta.upcomingRuns(SEQUENCE, NOW);

    // Assert
    expect(runs).toEqual([]);
    expect(upcoming).toEqual([]);
  });

  it("plans no run on a one-off rest day stored in the content", async () => {
    // Arrange
    const restDay = storedScheduleContentRepository();
    restDay.storeRestDays({ ...restDaysFixture(), "2026-10-12": "학사휴교" });
    const eta = etaOver(restDay);

    // Act
    const runs = await eta.runsOn(SEQUENCE, "2026-10-12");
    const upcoming = await eta.upcomingRuns(SEQUENCE, NOW);

    // Assert
    expect(runs).toEqual([]);
    expect(upcoming.map((r) => r.date)).not.toContain("2026-10-12");
  });

  it("plans the day's runs outside a suspension", async () => {
    // Arrange
    const eta = etaOver(storedScheduleContentRepository());

    // Act
    const runs = await eta.runsOn(SEQUENCE, "2026-10-12");

    // Assert
    expect(runs.map((r) => `${r.date} ${r.time}`)).toEqual(["2026-10-12 10:00"]);
  });
});

describe("BusEtaService.upcomingRuns before a stored suspension", () => {
  // Saturday 2026-12-19, 12:00 KST: no weekday run is left this week, so the smart view shows the week of 12-21.
  const SATURDAY = new Date("2026-12-19T03:00:00.000Z");
  const clock = { now: () => SATURDAY };
  const weekdays = (serviceId: string) => ({
    serviceId,
    patternId: "weekday",
    days: [1, 2, 3, 4, 5],
    entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["08:00", null, null] }],
  });
  const JAIN: EtaSequence = { ...SEQUENCE, serviceId: "campus-jain" };

  function etaOver(content: FakeBusScheduleContentRepository): BusEtaService {
    const timetable = new FakeBusScheduleRepository();
    timetable.patterns = [weekdays("campus-inja"), weekdays("campus-jain")];
    const schedule = new BusScheduleService(asReal<BusScheduleRepository>(timetable), asReal<HolidaysService>(new FakeHolidaysService()), storedScheduleContentService(clock, content), clock);
    return build(schedule);
  }

  it("plans no run on the days of a winter-break suspension that starts on 12-21, and leaves other services' runs", async () => {
    // Arrange
    const winterBreak = storedScheduleContentRepository();
    winterBreak.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-12-21", until: "2027-02-28" }));
    const eta = etaOver(winterBreak);

    // Act
    const suspended = await eta.upcomingRuns(SEQUENCE, SATURDAY);
    const running = await eta.upcomingRuns(JAIN, SATURDAY);

    // Assert
    expect(suspended).toEqual([]);
    expect(running.map((r) => `${r.date} ${r.time}`)).toEqual(["2026-12-21 08:00", "2026-12-22 08:00", "2026-12-23 08:00", "2026-12-24 08:00", "2026-12-25 08:00"]);
  });

  it("plans the same week's runs with no suspension stored", async () => {
    // Arrange
    const eta = etaOver(storedScheduleContentRepository());

    // Act
    const runs = await eta.upcomingRuns(SEQUENCE, SATURDAY);

    // Assert
    expect(runs.map((r) => r.date)).toEqual(["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-25"]);
  });
});

describe("BusEtaService.upcomingRuns before a suspension that starts mid-week", () => {
  // Monday 2026-12-14, 07:00 KST; the suspension runs Thursday 12-17 to Friday 12-18.
  const MONDAY = new Date("2026-12-13T22:00:00.000Z");
  const clock = { now: () => MONDAY };

  it("plans the runs before the suspension and none inside it", async () => {
    // Arrange
    const timetable = new FakeBusScheduleRepository();
    timetable.patterns = [
      {
        serviceId: "campus-inja",
        patternId: "weekday",
        days: [1, 2, 3, 4, 5],
        entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["08:00", null, null] }],
      },
    ];
    const content = storedScheduleContentRepository();
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-12-17", until: "2026-12-18" }));
    const schedule = new BusScheduleService(asReal<BusScheduleRepository>(timetable), asReal<HolidaysService>(new FakeHolidaysService()), storedScheduleContentService(clock, content), clock);

    // Act
    const runs = await build(schedule).upcomingRuns(SEQUENCE, MONDAY);

    // Assert
    expect(runs.map((r) => r.date)).toEqual(["2026-12-14", "2026-12-15", "2026-12-16"]);
  });
});

describe("BusEtaService.upcomingRuns around a suspension that starts on the next operating day", () => {
  // Saturday 2026-12-19, 12:00 KST, and Wednesday 2026-12-23, 07:00 KST (still Tuesday 12-22 in UTC, inside the suspension).
  const SATURDAY = new Date("2026-12-19T03:00:00.000Z");
  const WEDNESDAY = new Date("2026-12-22T22:00:00.000Z");
  const weekdays = {
    serviceId: "campus-inja",
    patternId: "weekday",
    days: [1, 2, 3, 4, 5],
    entries: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["08:00", null, null] }],
  };

  function etaAt(now: Date): BusEtaService {
    const clock = { now: () => now };
    const timetable = new FakeBusScheduleRepository();
    timetable.patterns = [weekdays];
    const content = storedScheduleContentRepository();
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-12-21", until: "2026-12-22" }));
    return build(new BusScheduleService(asReal<BusScheduleRepository>(timetable), asReal<HolidaysService>(new FakeHolidaysService()), storedScheduleContentService(clock, content), clock));
  }

  it("plans nothing on the Saturday before, and the rest of the week once the smart view leaves suspended", async () => {
    // Act
    const onSaturday = await etaAt(SATURDAY).upcomingRuns(SEQUENCE, SATURDAY);
    const onWednesday = await etaAt(WEDNESDAY).upcomingRuns(SEQUENCE, WEDNESDAY);

    // Assert
    // The Saturday smart view opens on Monday 12-21, inside the suspension, so it answers suspended and no run of
    // 12-23..12-25 is planned until Wednesday.
    expect(onSaturday).toEqual([]);
    expect(onWednesday.map((r) => r.date)).toEqual(["2026-12-23", "2026-12-24", "2026-12-25"]);
  });
});
