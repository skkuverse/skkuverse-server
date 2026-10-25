/**
 * Integration over JourneyRoutesController (GET /journey/routes) through the production pipeline (buildTestApp), with
 * revision 1 of `journey-routes` (the two 인자셔틀 options between 인사캠 정문 and 자과캠 정문): 200 with
 * `private, max-age=15`, `meta.serverNow` and both routes in data order, each option a walk to the boarding stop, the
 * 인자셔틀 ride and a walk to 정문, with places named in the request language and each tapped open on the map at it; the ride's board call equals the stop
 * page's call for the same run at 학생회관 버스 주차장, and its alight call the stop page's at N센터 앞 (ADR 0022, D1);
 * after Friday's last run the option is not running, ended, with Monday's first departure as its next service; and the
 * dataset never read answers 503 JOURNEY_ROUTES_UNAVAILABLE with no Cache-Control.
 *
 * Every store is in memory: the registry and route lines production stored (helpers/bus/), revision 1 of `bus-stops`,
 * the stored subway station coords, the two gates as buildings, a timetable and an estimate seeded per test. The
 * pollers never start (ROLE=api) and the clock is fixed, so each test boots its own app.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BuildingModule } from "../../../src/building/building.module";
import { BuildingRepository } from "../../../src/building/building.repository";
import { BusModule } from "../../../src/bus/bus.module";
import { BusCacheModule } from "../../../src/bus/cache/bus-cache.module";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import { BusDeparturesTimetableModule } from "../../../src/bus/departures/timetable/bus-departures-timetable.module";
import type { ShuttleEtaDoc } from "../../../src/bus/eta/bus-eta.document";
import { BusEtaModule } from "../../../src/bus/eta/bus-eta.module";
import { BusEtaRepository } from "../../../src/bus/eta/bus-eta.repository";
import { BusEtaSmartModule } from "../../../src/bus/eta/smart/bus-eta-smart.module";
import { BusLiveGroupModule } from "../../../src/bus/live/group/bus-live-group.module";
import { BusLiveHsscModule } from "../../../src/bus/live/hssc/bus-live-hssc.module";
import { BusLiveJongroModule } from "../../../src/bus/live/jongro/bus-live-jongro.module";
import { BusLiveModule } from "../../../src/bus/live/bus-live.module";
import { BusRealtimeArrivalModule } from "../../../src/bus/realtime/arrival/bus-realtime-arrival.module";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGroupModule } from "../../../src/bus/realtime/group/bus-realtime-group.module";
import { BusRealtimeHsscClient } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.client";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeHsscEtaModule } from "../../../src/bus/realtime/hssc-eta/bus-realtime-hssc-eta.module";
import { BusRealtimeJongroClient } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroModule } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.module";
import { BusRegistryModule } from "../../../src/bus/registry/bus-registry.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesModule } from "../../../src/bus/route-attributes/bus-route-attributes.module";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusRoutePathClient } from "../../../src/bus/route-path/bus-route-path.client";
import { BusRoutePathModule } from "../../../src/bus/route-path/bus-route-path.module";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { BusScheduleContentModule } from "../../../src/bus/schedule-content/bus-schedule-content.module";
import { BusScheduleContentRepository } from "../../../src/bus/schedule-content/bus-schedule-content.repository";
import { BusScheduleModule } from "../../../src/bus/schedule/bus-schedule.module";
import { BusScheduleRepository } from "../../../src/bus/schedule/bus-schedule.repository";
import { BusStopArrivalsModule } from "../../../src/bus/stop-arrivals/bus-stop-arrivals.module";
import { BusStopIndexModule } from "../../../src/bus/stop-index/bus-stop-index.module";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { Clock } from "../../../src/infra/clock";
import { JourneyDeparturesModule } from "../../../src/journey/departures/journey-departures.module";
import { JourneyModule } from "../../../src/journey/journey.module";
import { JourneyRepository } from "../../../src/journey/journey.repository";
import { JourneyPlacesModule } from "../../../src/journey/places/journey-places.module";
import { JourneyRoutesModule } from "../../../src/journey/routes/journey-routes.module";
import { journeyRoutes, journeyRoutesMeta } from "../../../src/journey/routes/journey-routes.wire";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { SubwayStationCoordsModule } from "../../../src/subway/station-coords/subway-station-coords.module";
import { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import { SubwayStationsModule } from "../../../src/subway/stations/subway-stations.module";
import { SubwayModule } from "../../../src/subway/subway.module";
import { storedBuilding } from "../../helpers/building/buildings";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { storedScheduleContentRepository } from "../../helpers/bus/schedule-content";
import { storedCalendarRepository } from "../../helpers/calendar/rest-days";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusEtaRepository } from "../../helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeJongroClient } from "../../helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRoutePathClient } from "../../helpers/fakes/bus/bus-route-path.client.fake";
import { FakeBusScheduleRepository } from "../../helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeJourneyRepository } from "../../helpers/fakes/journey/journey.repository.fake";
import { storedStationCoordsRepository } from "../../helpers/subway/station-coords";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

// WHY: Tuesday 2026-10-20 14:10 KST, with the afternoon 인자셔틀 runs ahead.
const AT_14_10_KST = new Date("2026-10-20T05:10:00.000Z");
// WHY: 20:00 KST on Friday 2026-10-23, after the week's last run.
const AT_FRIDAY_20_00_KST = new Date("2026-10-23T11:00:00.000Z");

const run = (index: number, time: string, routeType = "regular") => ({ index, time, routeType, busCount: 1, notes: null, stopTimes: [time, null] });
const weekday = (serviceId: string, times: string[]) => ({ serviceId, patternId: "weekday", days: [1, 2, 3, 4, 5], entries: times.map((time, index) => run(index + 1, time)) });
const PATTERNS = [weekday("campus-inja", ["08:00", "14:00", "14:30", "15:00", "15:30", "17:00"]), weekday("campus-jain", ["10:00", "14:30", "16:00", "18:00"])];

const { _about: journeyAbout, ...journeyRoutesData } = require("./fixtures/journey-routes.dataset.json") as Record<string, unknown>;
void journeyAbout;

const gate = (id: number, campus: "hssc" | "nsc", lng: number, lat: number) =>
  storedBuilding({ _id: id, buildNo: null, campus, type: "facility", name: { ko: "정문", en: "Main Gate" }, location: { type: "Point", coordinates: [lng, lat] } });

/** A live estimate of a campus-inja regular run on 2026-10-20, fetched five minutes before 14:10 KST. */
function liveEstimate(time: string, offsetsSec: number[]): ShuttleEtaDoc {
  return {
    _id: `campus-inja|regular|2026-10-20|${time}|live`,
    ...{ kind: "live", serviceId: "campus-inja", routeType: "regular", date: "2026-10-20", time },
    departAt: new Date(`2026-10-20T${time}:00+09:00`),
    offsetsSec,
    source: "naver",
    fetchedAt: new Date(AT_14_10_KST.getTime() - 5 * 60_000),
    expiresAt: new Date("2026-10-21T00:00:00.000Z"),
  };
}

interface Stores {
  journey: FakeJourneyRepository;
  timetable: FakeBusScheduleRepository;
  estimates: FakeBusEtaRepository;
}

function freshStores(): Stores {
  const journey = new FakeJourneyRepository();
  journey.storeRoutes(journeyRoutesData);
  const timetable = new FakeBusScheduleRepository();
  timetable.patterns = structuredClone(PATTERNS);
  return { journey, timetable, estimates: new FakeBusEtaRepository() };
}

let app: NestExpressApplication | undefined;

async function boot(stores: Stores, now = AT_14_10_KST): Promise<import("http").Server> {
  const buildings = new FakeBuildingRepository();
  buildings.buildings = [gate(1, "hssc", 126.997131, 37.584865), gate(7, "nsc", 126.974074, 37.290649)];
  app = await buildTestApp({
    imports: [
      SchedulingModule,
      ...[BusModule, BusCacheModule, BusRegistryModule, BusRouteAttributesModule, BusRoutePathModule],
      ...[BusRealtimeModule, BusRealtimeHsscModule, BusRealtimeJongroModule, BusRealtimeArrivalModule, BusRealtimeGroupModule, BusRealtimeHsscEtaModule],
      ...[BusStopsModule, BusScheduleContentModule, BusScheduleModule, BusEtaModule, BusEtaSmartModule, BusConfigModule],
      ...[BusLiveModule, BusLiveJongroModule, BusLiveHsscModule, BusLiveGroupModule, BusStopIndexModule, BusStopArrivalsModule],
      ...[BuildingModule, SubwayModule, SubwayStationsModule, SubwayStationCoordsModule],
      ...[BusDeparturesTimetableModule, JourneyModule, JourneyDeparturesModule, JourneyPlacesModule, JourneyRoutesModule],
    ],
    overrides: [
      { provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() },
      { provide: BusCacheRepository, useValue: new FakeBusCacheRepository() },
      { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
      { provide: BusRoutePathClient, useValue: new FakeBusRoutePathClient() },
      { provide: BusRealtimeHsscClient, useValue: new FakeBusRealtimeHsscClient() },
      { provide: BusRealtimeJongroClient, useValue: new FakeBusRealtimeJongroClient() },
      { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
      { provide: BusScheduleRepository, useValue: stores.timetable },
      { provide: BusScheduleContentRepository, useValue: storedScheduleContentRepository() },
      { provide: BusEtaRepository, useValue: stores.estimates },
      { provide: CalendarRepository, useValue: storedCalendarRepository() },
      { provide: BuildingRepository, useValue: buildings },
      { provide: SubwayStationCoordsRepository, useValue: storedStationCoordsRepository() },
      { provide: JourneyRepository, useValue: stores.journey },
      { provide: Clock, useValue: { now: () => new Date(now) } },
    ],
    role: "api",
  });
  return app.getHttpServer();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

type Call = Record<string, unknown> & { runId: string | null };
type Leg = Record<string, any> & { kind: string };
type Option = Record<string, any> & { legs: Leg[] };
type Route = { id: string; options: Option[] } & Record<string, any>;
const withoutLang = ({ lang: _lang, ...meta }: { lang?: string }) => meta;
const rideOf = (route: Route): Leg => route.options[0]!.legs.find((leg) => leg.kind === "ride")!;

/** The stop page's timetabled call of `runId`, without the run's departure the page serves beside it. */
async function stopPageCall(server: import("http").Server, stopId: string, runId: string): Promise<Call | undefined> {
  const page = await request(server).get(`/bus/stops/${stopId}/arrivals`);
  const arrivals = (page.body.data.routes as Array<{ kind: string; arrivals: Array<Call & { runDepartureAt: string }> }>).flatMap((entry) => (entry.kind === "timetable" ? entry.arrivals : []));
  const found = arrivals.find((arrival) => arrival.runId === runId);
  if (!found) return undefined;
  const call: Partial<typeof found> = { ...found };
  delete call.runDepartureAt;
  return call as Call;
}

describe("GET /journey/routes", () => {
  it("serves both routes, each 인자셔틀 option a walk, the ride and a walk, private for 15 s with serverNow", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/journey/routes");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=15");
    expect(res.body.meta).toEqual({ lang: "ko", serverNow: "2026-10-20T14:10:00+09:00" });
    const routes = res.body.data.routes as Route[];
    expect(routes.map((route) => [route.id, route.name, route.from.name, route.to.name])).toEqual([
      ["hssc-to-nsc", "인사캠 → 자과캠", "정문", "정문"],
      ["nsc-to-hssc", "자과캠 → 인사캠", "정문", "정문"],
    ]);
    const [toNsc] = routes;
    expect(toNsc!.options.map((option) => [option.id, option.status, option.leaveAt, option.arriveAt])).toEqual([["inja", "running", "2026-10-20T14:23:00+09:00", "2026-10-20T15:56:00+09:00"]]);
    expect(toNsc!.options[0]!.legs.map((leg) => [leg.kind, leg.mode, leg.label, leg.from.id, leg.to.id, leg.startAt, leg.endAt])).toEqual([
      ["walk", "walk", "도보", "1", "hssc-bus-lot", "2026-10-20T14:23:00+09:00", "2026-10-20T14:29:00+09:00"],
      ["ride", "shuttle", "인자셔틀", "hssc-bus-lot", "nsc-n-center", "2026-10-20T14:30:00+09:00", "2026-10-20T15:52:00+09:00"],
      ["walk", "walk", "도보", "nsc-n-center", "7", "2026-10-20T15:52:00+09:00", "2026-10-20T15:56:00+09:00"],
    ]);
    expect(rideOf(toNsc!)).toMatchObject({ basis: "estimate", waitSec: 60, color: "003626", icon: "shuttle", line: { id: "inja", name: "인자셔틀" } });
    expect(rideOf(toNsc!).later.map((call: Call) => call.runId)).toEqual(["campus-inja|regular|2026-10-20|15:00", "campus-inja|regular|2026-10-20|15:30"]);
    expectWire(journeyRoutes, res.body.data);
    expectWire(journeyRoutesMeta, withoutLang(res.body.meta));
  });

  it("The 인자셔틀 leg's board and alight calls equal the stop pages' calls for the same run", async () => {
    // Arrange
    const stores = freshStores();
    stores.estimates.docs.set("campus-inja|regular|2026-10-20|14:30|live", liveEstimate("14:30", [0, 4500]));
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/journey/routes");

    // Assert
    const ride = rideOf((res.body.data.routes as Route[])[0]!);
    expect(ride.board.runId).toBe("campus-inja|regular|2026-10-20|14:30");
    expect(ride.board).toEqual(await stopPageCall(server, "hssc-bus-lot", ride.board.runId));
    expect(ride.alight).toEqual(await stopPageCall(server, "nsc-n-center", ride.board.runId));
    expect(ride.alight).toMatchObject({ expectedArrivalAt: "2026-10-20T15:45:00+09:00", basis: "estimate" });
  });

  it("serves the places and labels in the request language", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/journey/routes").set("Accept-Language", "en");

    // Assert
    const [toNsc] = res.body.data.routes as Route[];
    expect([toNsc!.name, toNsc!.from.name, rideOf(toNsc!).from.name, rideOf(toNsc!).label, toNsc!.options[0]!.legs[0]!.label]).toEqual([
      "HSSC → NSC",
      "Main Gate",
      "Student Union bus parking lot",
      "INJA Shuttle",
      "Walk",
    ]);
  });

  it("serves each place's tap as a route to the map at that place", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/journey/routes");

    // Assert
    const [toNsc] = res.body.data.routes as Route[];
    const ride = rideOf(toNsc!);
    expect([toNsc!.from.action, ride.from.action, ride.to.action, toNsc!.to.action]).toEqual([
      { actionType: "route", actionValue: "/map?place=skku_building:1" },
      { actionType: "route", actionValue: "/map?place=bus_stop:hssc-bus-lot" },
      { actionType: "route", actionValue: "/map?place=bus_stop:nsc-n-center" },
      { actionType: "route", actionValue: "/map?place=skku_building:7" },
    ]);
    expectWire(journeyRoutes, res.body.data);
  });

  it("Ended: after Friday's last run the option is not running, with Monday's first departure as its next service", async () => {
    // Arrange
    const server = await boot(freshStores(), AT_FRIDAY_20_00_KST);

    // Act
    const res = await request(server).get("/journey/routes");

    // Assert
    const [toNsc] = res.body.data.routes as Route[];
    expect(toNsc!.options).toEqual([
      expect.objectContaining({ id: "inja", status: "notRunning", reason: "ended", nextServiceAt: "2026-10-26T08:00:00+09:00", leaveAt: null, arriveAt: null, legs: [] }),
    ]);
    expectWire(journeyRoutes, res.body.data);
  });

  // WHY: the service day starts at 03:00 KST, so before it the night after the last run reads 운행종료 (ended), and
  // from it the morning before the 08:00 first run, more than the plan's three hours away, reads not started.
  it.each([
    ["02:30, before the service day starts", "2026-10-20T02:30:00+09:00", "ended"],
    ["04:00, inside the service day", "2026-10-20T04:00:00+09:00", "notStarted"],
  ])("No run in the window at %s: the option is %s, with the 08:00 first run next", async (_case, nowAt, reason) => {
    // Arrange
    const server = await boot(freshStores(), new Date(nowAt));

    // Act
    const res = await request(server).get("/journey/routes");

    // Assert
    const [toNsc] = res.body.data.routes as Route[];
    expect(toNsc!.options).toEqual([expect.objectContaining({ id: "inja", status: "notRunning", reason, nextServiceAt: "2026-10-20T08:00:00+09:00", legs: [] })]);
    expectWire(journeyRoutes, res.body.data);
  });

  it("answers 503 JOURNEY_ROUTES_UNAVAILABLE with no Cache-Control when the dataset was never stored", async () => {
    // Arrange
    const stores = freshStores();
    stores.journey.stored = null;
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/journey/routes");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: "JOURNEY_ROUTES_UNAVAILABLE", message: "The journey routes are unavailable" } });
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});
