/**
 * BusEtaSmartService over in-memory timetable and estimate stores, a fixed
 * clock and revision 1 of the stored bus-stops: the smart view's ETag and
 * Cache-Control, the estimates it applies, read at most once per 30 s, and the
 * stored timetable when the estimates or the stops cannot be read; the same body
 * without an ETag for a caller that serves none (the stop page, review F5).
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../../infra/logger", () => mockLogger);

import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { storedScheduleContentService } from "../../../../__tests__/helpers/bus/schedule-content";
import { FakeBusScheduleRepository } from "../../../../__tests__/helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeHolidaysService } from "../../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { HolidaysService } from "../../../holidays/holidays.service";
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
  schedule = new BusScheduleService(asReal<BusScheduleRepository>(timetable), asReal<HolidaysService>(new FakeHolidaysService()), storedScheduleContentService(clock), clock);
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

// WHY: the stop page is no-store and serves no ETag, so it must not hash each service's week per request (unify-bus-stops review F5).
describe("BusEtaSmartService.resolveSmart", () => {
  it("answers the smart view's body, estimates applied, with no ETag or Cache-Control", async () => {
    // Act
    const resolved = await service.resolveSmart("campus-inja", "ko");

    // Assert
    expect(resolved).toEqual((await service.getSmart("campus-inja", "ko")).data);
    expect(resolved.days[0]!.schedule[0]).toMatchObject({ stopTimes: ["10:00", "10:51"], eta: { source: "live" } });
    expect(resolved).not.toHaveProperty("etag");
    expect(resolved).not.toHaveProperty("cacheControl");
  });

  it("carries the localized message on a status other than active", async () => {
    // Act
    const resolved = await service.resolveSmart("fasttrack-inja", "en");

    // Assert
    expect(resolved).toMatchObject({ status: "noData", message: "Schedule information is being prepared" });
  });

  it("refuses an unknown service with SERVICE_NOT_FOUND", async () => {
    // Act & Assert
    await expect(service.resolveSmart("nope", "ko")).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND", httpStatus: 404 });
  });
});
