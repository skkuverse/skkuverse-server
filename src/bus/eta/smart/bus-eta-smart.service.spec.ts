/**
 * BusEtaSmartService over in-memory timetable and estimate stores, a fixed
 * clock and revision 1 of the stored bus-stops: the smart view's ETag and
 * Cache-Control, the estimates it applies, read at most once per 30 s, and the
 * stored timetable when the estimates or the stops cannot be read; and the run
 * read the stop page lists from (review F1): each run of the shown week, and of
 * the week after it when asked, still under way, as instants, with the served
 * estimate applied and, for the listing cutoff only, the latest one, from the same
 * read (ADR 0019, D12).
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../../infra/logger", () => mockLogger);

import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { serviceNoticesWithSuspension, storedScheduleContentRepository, storedScheduleContentService } from "../../../../__tests__/helpers/bus/schedule-content";
import { FakeBusScheduleRepository } from "../../../../__tests__/helpers/fakes/bus/bus-schedule.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../../infra/clock";
import type { BusScheduleRepository } from "../../schedule/bus-schedule.repository";
import { BusScheduleService } from "../../schedule/bus-schedule.service";
import { storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import { FakeBusStopsRepository } from "../../../../__tests__/helpers/fakes/bus/bus-stops.repository.fake";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { BusEtaRepository } from "../bus-eta.repository";
import { BusEtaSmartService } from "./bus-eta-smart.service";

const NOW = new Date("2026-10-12T00:40:00.000Z"); // 09:40 KST on a Monday
const clock: Clock = { now: () => NOW };
const LIVE: ShuttleEtaDoc = {
  _id: "campus-inja|regular|2026-10-12|10:00|live",
  kind: "live",
  serviceId: "campus-inja",
  routeType: "regular",
  date: "2026-10-12",
  time: "10:00",
  departAt: new Date("2026-10-12T01:00:00.000Z"),
  offsetsSec: [0, 3060],
  source: "naver",
  fetchedAt: new Date("2026-10-12T00:35:00.000Z"),
  expiresAt: new Date("2026-10-20T01:00:00.000Z"),
};

let estimates: FakeBusEtaRepository;
let schedule: BusScheduleService;
let service: BusEtaSmartService;

beforeEach(() => {
  const timetable = new FakeBusScheduleRepository();
  timetable.patterns = [
    { serviceId: "campus-inja", patternId: "monday", days: [1], entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null] }] },
  ];
  estimates = new FakeBusEtaRepository();
  estimates.docs.set(LIVE._id, LIVE);
  schedule = new BusScheduleService(asReal<BusScheduleRepository>(timetable), storedScheduleContentService(clock), clock);
  service = new BusEtaSmartService(schedule, asReal<BusEtaRepository>(estimates), storedBusStopsService(), clock);
});

describe("BusEtaSmartService.getSmart", () => {
  it("applies a live estimate, tags the ETag smart-<service>-<from>, and caches it 60 s", async () => {
    // Act
    const smart = await service.getSmart("campus-inja", "ko");

    // Assert
    expect(smart.data.days[0]!.schedule[0]).toMatchObject({ stopTimes: ["10:00", "10:51"], eta: { source: "live" } });
    expect(smart.etag).toMatch(/^"smart-campus-inja-2026-10-12-[a-f0-9]{32}"$/);
    expect(smart.cacheControl).toBe("private, max-age=60");
  });

  it("reads the estimate store once per 30 s", async () => {
    // Act
    await service.getSmart("campus-inja", "ko");
    await service.getSmart("campus-inja", "ko");

    // Assert
    expect(estimates.unexpiredReads).toBe(1);
  });

  it("serves the stored timetable when the estimates cannot be read", async () => {
    // Arrange
    estimates.failWith = new Error("down");

    // Act
    const smart = await service.getSmart("campus-inja", "ko");

    // Assert
    expect(smart.data.days[0]!.schedule[0]).toEqual({ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null] });
  });

  it("Smart schedule without stops: serves the stored timetable without estimates while the stops were never read", async () => {
    // Arrange
    const neverRead = new BusEtaSmartService(schedule, asReal<BusEtaRepository>(estimates), storedBusStopsService(new FakeBusStopsRepository()), clock);

    // Act
    const smart = await neverRead.getSmart("campus-inja", "ko");

    // Assert
    expect(smart.data.status).toBe("active");
    expect(smart.data.days[0]!.schedule[0]).toEqual({ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null] });
  });

  it("logs bus.eta.stops_unavailable, not bus.eta.read_failed, when the stops are the cause (review F6)", async () => {
    // Arrange
    const neverRead = new BusEtaSmartService(schedule, asReal<BusEtaRepository>(estimates), storedBusStopsService(new FakeBusStopsRepository()), clock);
    mockLogger.warn.mockClear();

    // Act
    await neverRead.getSmart("campus-inja", "ko");

    // Assert
    expect(mockLogger.warn.mock.calls.map(([fields]) => fields.event)).toEqual(["bus.eta.stops_unavailable"]);
    expect(mockLogger.warn.mock.calls[0]![0]).toMatchObject({ serviceId: "campus-inja", suppressed: 0, err: expect.objectContaining({ code: "BUS_STOPS_UNAVAILABLE" }) });
  });

  it("logs bus.eta.read_failed when the estimates cannot be read and the stops can", async () => {
    // Arrange
    estimates.failWith = new Error("down");
    mockLogger.warn.mockClear();

    // Act
    await service.getSmart("campus-inja", "ko");

    // Assert
    expect(mockLogger.warn.mock.calls.map(([fields]) => fields.event)).toEqual(["bus.eta.read_failed"]);
  });

  it("refuses an unknown service with SERVICE_NOT_FOUND", async () => {
    // Act & Assert
    await expect(service.getSmart("nope", "ko")).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND", httpStatus: 404 });
  });

  it("carries the localized message on a status other than active, cached 300 s without estimates", async () => {
    // Act
    const smart = await service.getSmart("fasttrack-inja", "en");

    // Assert
    expect(smart.data).toMatchObject({ status: "noData", message: "Schedule information is being prepared" });
    expect(smart.cacheControl).toBe("private, max-age=300");
  });
});

// WHY: the stop page lists a stop's next runs from instants, never from the smart view's "HH:mm" (review F1).
describe("BusEtaSmartService.listRuns", () => {
  const PREDICTED: ShuttleEtaDoc = {
    ...LIVE,
    _id: "campus-inja|regular|2026-10-19|10:00|baseline",
    kind: "baseline",
    date: "2026-10-19",
    departAt: new Date("2026-10-19T01:00:00.000Z"),
    offsetsSec: [0, 3000],
  };
  const at = (iso: string) => new Date(iso);

  it("answers each run of the shown week as instants, the served estimate applied at its estimated stop", async () => {
    // Act
    const runList = await service.listRuns("campus-inja", { from: NOW, weekCount: 1 });

    // Assert
    expect(runList).toEqual({
      status: "active",
      runs: [
        {
          runId: "campus-inja|regular|2026-10-12|10:00",
          routeType: "regular",
          date: "2026-10-12",
          departureAt: at("2026-10-12T01:00:00.000Z"),
          isLastOfDay: true,
          stopTimes: [
            { shownAt: at("2026-10-12T01:00:00.000Z"), isEstimated: false, latestEstimateAt: null },
            { shownAt: at("2026-10-12T01:51:00.000Z"), isEstimated: true, latestEstimateAt: at("2026-10-12T01:51:00.000Z") },
          ],
          estimate: { source: "live", updatedAt: LIVE.fetchedAt },
        },
      ],
    });
  });

  it.each([
    ["in the minute of its last instant", "2026-10-12T01:51:59.000Z", ["2026-10-12"]],
    ["the minute after its last instant", "2026-10-12T01:52:00.000Z", []],
  ])("keeps a run %s: from %s", async (_case, from, dates) => {
    // Act
    const { runs } = await service.listRuns("campus-inja", { from: new Date(from), weekCount: 1 });

    // Assert
    expect(runs.map((run) => run.date)).toEqual(dates);
  });

  it("reads on into the week after the shown one, its estimates applied, only when asked for two weeks", async () => {
    // Arrange
    estimates.docs.set(PREDICTED._id, PREDICTED);

    // Act
    const [one, two] = await Promise.all([service.listRuns("campus-inja", { from: NOW, weekCount: 1 }), service.listRuns("campus-inja", { from: NOW, weekCount: 2 })]);

    // Assert
    expect(one.runs.map((run) => run.date)).toEqual(["2026-10-12"]);
    expect(two.runs.map((run) => [run.date, run.estimate?.source, run.stopTimes[1]?.shownAt])).toEqual([
      ["2026-10-12", "live", at("2026-10-12T01:51:00.000Z")],
      ["2026-10-19", "predicted", at("2026-10-19T01:50:00.000Z")],
    ]);
  });

  it("keeps the following week's runs to their served estimate, with no latest one beside it (ADR 0019, D12)", async () => {
    // Arrange
    const newerLive = { ...PREDICTED, _id: "campus-inja|regular|2026-10-19|10:00|live", kind: "live" as const, offsetsSec: [0, 3600], fetchedAt: new Date("2026-10-12T00:39:00.000Z") };
    estimates.docs.set(PREDICTED._id, PREDICTED);
    estimates.docs.set(newerLive._id, newerLive);

    // Act
    const { runs } = await service.listRuns("campus-inja", { from: NOW, weekCount: 2 });

    // Assert
    expect(runs.map((run) => [run.date, run.stopTimes[1]?.latestEstimateAt ?? null])).toEqual([
      ["2026-10-12", at("2026-10-12T01:51:00.000Z")],
      ["2026-10-19", null],
    ]);
  });

  it("carries a live value fetched 20 minutes ago, which the smart view no longer serves, as the latest estimate only, from the same read", async () => {
    // Arrange
    estimates.docs.set(LIVE._id, { ...LIVE, fetchedAt: new Date("2026-10-12T00:20:00.000Z") });

    // Act
    const { runs } = await service.listRuns("campus-inja", { from: NOW, weekCount: 1 });
    await service.getSmart("campus-inja", "ko");

    // Assert
    expect(runs[0]!.estimate).toBeNull();
    expect(runs[0]!.stopTimes[1]).toEqual({ shownAt: null, isEstimated: false, latestEstimateAt: at("2026-10-12T01:51:00.000Z") });
    expect(estimates.unexpiredReads).toBe(1);
  });

  it("answers the stored timetable with no estimate when the estimates cannot be read", async () => {
    // Arrange
    estimates.failWith = new Error("down");

    // Act
    const { runs } = await service.listRuns("campus-inja", { from: NOW, weekCount: 1 });

    // Assert
    expect(runs[0]!.estimate).toBeNull();
    expect(runs[0]!.stopTimes[1]).toEqual({ shownAt: null, isEstimated: false, latestEstimateAt: null });
  });

  it("answers a suspended service as suspended with no run, even when two weeks are asked for", async () => {
    // Arrange
    const content = storedScheduleContentRepository();
    content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-10-12", until: "2026-10-16" }));
    const suspendedSchedule = new BusScheduleService(asReal<BusScheduleRepository>(new FakeBusScheduleRepository()), storedScheduleContentService(clock, content), clock);
    const suspended = new BusEtaSmartService(suspendedSchedule, asReal<BusEtaRepository>(estimates), storedBusStopsService(), clock);

    // Act
    const runList = await suspended.listRuns("campus-inja", { from: NOW, weekCount: 2 });

    // Assert
    expect(runList).toEqual({ status: "suspended", runs: [] });
  });

  it("answers a schedule that is not active with its status and no run", async () => {
    // Act
    const runList = await service.listRuns("fasttrack-inja", { from: NOW, weekCount: 2 });

    // Assert
    expect(runList).toEqual({ status: "noData", runs: [] });
  });

  it("refuses an unknown service with SERVICE_NOT_FOUND", async () => {
    // Act & Assert
    await expect(service.listRuns("nope", { from: NOW, weekCount: 1 })).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND", httpStatus: 404 });
  });
});
