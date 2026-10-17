/**
 * BusEtaSmartService over in-memory timetable and estimate stores, a fixed
 * clock and the real stop catalog: the smart view's ETag and Cache-Control,
 * the estimates it applies, read at most once per 30 s, and the stored
 * timetable when the estimates cannot be read.
 */
import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusScheduleRepository } from "../../../../__tests__/helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeHolidaysService } from "../../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { HolidaysService } from "../../../holidays/holidays.service";
import type { Clock } from "../../../infra/clock";
import type { BusScheduleRepository } from "../../schedule/bus-schedule.repository";
import { BusScheduleService } from "../../schedule/bus-schedule.service";
import { BusStopsService } from "../../stops/bus-stops.service";
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
let service: BusEtaSmartService;

beforeEach(() => {
  const timetable = new FakeBusScheduleRepository();
  timetable.patterns = [
    { serviceId: "campus-inja", patternId: "monday", days: [1], entries: [{ index: 1, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null] }] },
  ];
  estimates = new FakeBusEtaRepository();
  estimates.docs.set(LIVE._id, LIVE);
  const schedule = new BusScheduleService(asReal<BusScheduleRepository>(timetable), asReal<HolidaysService>(new FakeHolidaysService()), clock);
  service = new BusEtaSmartService(schedule, asReal<BusEtaRepository>(estimates), new BusStopsService(), clock);
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
