/**
 * Integration over JourneyRoutesController (GET /journey/routes) and BusLiveGroupController (GET /bus/live/:groupId)
 * through the production pipeline (buildTestApp), with revision 3 of `journey-routes` (the 종로 08 and 7800 options
 * each way) and the TOPIS rows of 2026-10-25 (fixtures/topis-arrivals-service-hours.json) stored in bus_cache as the
 * poller writes them, moved to Tuesday 2026-10-20 so the trimmed weekday subway tables run (every date moved, every
 * time of day kept), beside the trimmed `subway-timetables`, the stored registry with 7800's and the four 7800 stops
 * `bus-stops` aliases:
 *
 * - a 종로 08 ride boards the predicted vehicle at 명륜시장.성대후문 (100900046), its board call equal to the one
 *   `/bus/live/jongro08` serves there for the same vehicle, and a 7800 ride boards at 사당역9번출구 (119000302) with
 *   the call `/bus/live/gyeonggi7800` serves at sadang-exit9 for the same vehicle; each clock is set before TOPIS made
 *   its rows so the predicted bus is still catchable after the walk, since the door reads TOPIS's predicted instants
 *   and never the clock;
 * - a ride past both predicted vehicles names no vehicle and boards half the stored headway after the rider is ready,
 *   as an estimate, and a vehicle GBIS reports with no seat left is skipped for it; the 1호선 board after such a ride
 *   warns `connectionAtRisk` when the rider has less time at 종로5가 than that arrival's uncertainty;
 * - rows a poller older than the stored headway wrote serve with no extrapolation;
 * - past the pole's last run, or once TOPIS says 운행종료 there, the option is not running, ended, with the next
 *   day's first run from the stored firstTm; before the first run, past the plan's window, with today's, and inside
 *   it the ride boards that first run at TOPIS's published time; overnight, with no rows stored, the next first run
 *   comes from the hours the poller kept on the route;
 * - an option whose first ride is a subway line after its last train, or whose TOPIS ride after 4호선 has ended, names
 *   its next service too.
 *
 * Every store is in memory; the pollers never start (ROLE=api), and each clock instant boots its own app.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BuildingModule } from "../../../src/building/building.module";
import { BuildingRepository } from "../../../src/building/building.repository";
import { BusModule } from "../../../src/bus/bus.module";
import type { JongroArrivalDoc } from "../../../src/bus/cache/bus-cache.document";
import type { StationServiceHours } from "../../../src/bus/registry/bus-registry.document";
import { BusCacheModule } from "../../../src/bus/cache/bus-cache.module";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import { BusDeparturesModule } from "../../../src/bus/departures/bus-departures.module";
import { BusDeparturesTimetableModule } from "../../../src/bus/departures/timetable/bus-departures-timetable.module";
import { BusDeparturesTopisModule } from "../../../src/bus/departures/topis/bus-departures-topis.module";
import { BusEtaModule } from "../../../src/bus/eta/bus-eta.module";
import { BusEtaRepository } from "../../../src/bus/eta/bus-eta.repository";
import { BusEtaSmartModule } from "../../../src/bus/eta/smart/bus-eta-smart.module";
import { BusLiveGroupModule } from "../../../src/bus/live/group/bus-live-group.module";
import { BusLiveHsscModule } from "../../../src/bus/live/hssc/bus-live-hssc.module";
import { BusLiveJongroModule } from "../../../src/bus/live/jongro/bus-live-jongro.module";
import { BusLiveModule } from "../../../src/bus/live/bus-live.module";
import { liveGroup } from "../../../src/bus/live/bus-live.wire";
import { BusRealtimeArrivalModule } from "../../../src/bus/realtime/arrival/bus-realtime-arrival.module";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGbisClient } from "../../../src/bus/realtime/gbis/bus-realtime-gbis.client";
import { BusRealtimeGbisModule } from "../../../src/bus/realtime/gbis/bus-realtime-gbis.module";
import { BusRealtimeGbisRepository } from "../../../src/bus/realtime/gbis/bus-realtime-gbis.repository";
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
import { BusStopIndexModule } from "../../../src/bus/stop-index/bus-stop-index.module";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { CalendarModule } from "../../../src/calendar/calendar.module";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { Clock } from "../../../src/infra/clock";
import { JourneyDeparturesModule } from "../../../src/journey/departures/journey-departures.module";
import { JourneyModule } from "../../../src/journey/journey.module";
import { JourneyRepository } from "../../../src/journey/journey.repository";
import { JourneyPlacesModule } from "../../../src/journey/places/journey-places.module";
import { JourneyRoutesModule } from "../../../src/journey/routes/journey-routes.module";
import { journeyRoutes } from "../../../src/journey/routes/journey-routes.wire";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { SubwayEstimateModule } from "../../../src/subway/estimate/subway-estimate.module";
import { SubwayStationCoordsModule } from "../../../src/subway/station-coords/subway-station-coords.module";
import { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import { SubwayStationsModule } from "../../../src/subway/stations/subway-stations.module";
import { SubwayModule } from "../../../src/subway/subway.module";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import { SubwayTimetableDeparturesModule } from "../../../src/subway/timetable/departures/subway-timetable-departures.module";
import { SubwayTimetableModule } from "../../../src/subway/timetable/subway-timetable.module";
import { SubwayTimetableRepository } from "../../../src/subway/timetable/subway-timetable.repository";
import { SubwayTopologyModule } from "../../../src/subway/topology/subway-topology.module";
import { SubwayTopologyRepository } from "../../../src/subway/topology/subway-topology.repository";
import { storedBuilding } from "../../helpers/building/buildings";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { busStopsFixture, storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { storedScheduleContentRepository } from "../../helpers/bus/schedule-content";
import { registryDoc7800, routePathDoc7800 } from "../../helpers/bus/topis-7800";
import { serviceHoursDocs, withoutServiceHours } from "../../helpers/bus/topis-service-hours";
import { storedCalendarRepository } from "../../helpers/calendar/rest-days";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusEtaRepository } from "../../helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusRealtimeGbisClient } from "../../helpers/fakes/bus/bus-realtime-gbis.client.fake";
import { FakeBusRealtimeGbisRepository } from "../../helpers/fakes/bus/bus-realtime-gbis.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeJongroClient } from "../../helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRoutePathClient } from "../../helpers/fakes/bus/bus-route-path.client.fake";
import { FakeBusScheduleRepository } from "../../helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeJourneyRepository } from "../../helpers/fakes/journey/journey.repository.fake";
import { FakeSubwayRepository } from "../../helpers/fakes/subway/subway.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { storedStationCoordsRepository } from "../../helpers/subway/station-coords";
import { storedSubwayTimetableRepository } from "../../helpers/subway/timetables";
import { storedSubwayTopologyRepository } from "../../helpers/subway/topology";
import proposal from "../bus/fixtures/bus-stops-7800-proposal.json";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

const TUESDAY = "2026-10-20";
const at = (clock: string, day = TUESDAY) => new Date(`${day}T${clock}+09:00`);

const { _about: journeyAbout, ...revision3 } = require("./fixtures/journey-routes-revision-3.dataset.json") as Record<string, unknown>;
void journeyAbout;

const gate = (id: number, campus: "hssc" | "nsc", lng: number, lat: number) =>
  storedBuilding({ _id: id, buildNo: null, campus, type: "facility", name: { ko: "정문", en: "Main Gate" }, location: { type: "Point", coordinates: [lng, lat] } });

type Rows = { jongro08?: JongroArrivalDoc[]; gyeonggi7800?: JongroArrivalDoc[] };
type Seats = Array<{ vehicleId: string; seatsLeft: number | null }>;

const apps: NestExpressApplication[] = [];

async function boot(now: Date, rows: Rows = {}, seats: Seats = [], jongro08Hours: StationServiceHours[] = []): Promise<import("http").Server> {
  const journey = new FakeJourneyRepository();
  journey.storeRoutes(revision3);
  const buildings = new FakeBuildingRepository();
  buildings.buildings = [gate(1, "hssc", 126.997131, 37.584865), gate(7, "nsc", 126.974074, 37.290649)];
  const busCache = new FakeBusCacheRepository();
  busCache.writtenAt = now;
  busCache.values.set("jongro_stations_08", rows.jongro08 ?? serviceHoursDocs("jongro08", TUESDAY));
  busCache.values.set("jongro_locations_08", []);
  busCache.values.set("jongro_stations_7800", rows.gyeonggi7800 ?? serviceHoursDocs("gyeonggi7800", TUESDAY));
  busCache.values.set("jongro_locations_7800", []);
  const registry = storedBusRegistryRepository();
  registry.routes.set("gyeonggi7800", registryDoc7800());
  registry.routes.set("jongro08", { ...registry.routes.get("jongro08")!, serviceHours: jongro08Hours });
  const routePaths = storedBusRoutePathRepository();
  routePaths.routePaths.set("gyeonggi7800", routePathDoc7800());
  const stops = busStopsFixture() as { stops: unknown[] };
  stops.stops.push(...structuredClone(proposal.stops));
  const gbis = new FakeBusRealtimeGbisRepository();
  gbis.seatsByRouteId.set("gyeonggi7800", { _id: "gyeonggi7800", seats, checkedAt: now });
  const app = await buildTestApp({
    imports: [
      SchedulingModule,
      CalendarModule,
      ...[BusModule, BusCacheModule, BusRegistryModule, BusRouteAttributesModule, BusRoutePathModule, BusRealtimeModule, BusRealtimeHsscModule, BusRealtimeJongroModule],
      ...[BusRealtimeGbisModule, BusRealtimeArrivalModule, BusRealtimeGroupModule, BusRealtimeHsscEtaModule, BusStopsModule, BusScheduleContentModule, BusScheduleModule],
      ...[BusEtaModule, BusEtaSmartModule, BusConfigModule, BusLiveModule, BusLiveJongroModule, BusLiveHsscModule, BusLiveGroupModule, BusStopIndexModule],
      ...[BuildingModule, SubwayModule, SubwayStationsModule, SubwayTopologyModule, SubwayStationCoordsModule, SubwayTimetableModule, SubwayEstimateModule],
      ...[SubwayTimetableDeparturesModule, BusDeparturesModule, BusDeparturesTimetableModule, BusDeparturesTopisModule],
      ...[JourneyModule, JourneyDeparturesModule, JourneyPlacesModule, JourneyRoutesModule],
    ],
    overrides: [
      { provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() },
      { provide: BusCacheRepository, useValue: busCache },
      { provide: BusRegistryRepository, useValue: registry },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusRoutePathRepository, useValue: routePaths },
      { provide: BusRoutePathClient, useValue: new FakeBusRoutePathClient() },
      { provide: BusRealtimeHsscClient, useValue: new FakeBusRealtimeHsscClient() },
      { provide: BusRealtimeJongroClient, useValue: new FakeBusRealtimeJongroClient() },
      { provide: BusRealtimeGbisClient, useValue: new FakeBusRealtimeGbisClient() },
      { provide: BusRealtimeGbisRepository, useValue: gbis },
      { provide: BusStopsRepository, useValue: storedBusStopsRepository(stops) },
      { provide: BusScheduleRepository, useValue: new FakeBusScheduleRepository() },
      { provide: BusScheduleContentRepository, useValue: storedScheduleContentRepository() },
      { provide: BusEtaRepository, useValue: new FakeBusEtaRepository() },
      { provide: CalendarRepository, useValue: storedCalendarRepository() },
      { provide: BuildingRepository, useValue: buildings },
      { provide: SubwayRepository, useValue: new FakeSubwayRepository() },
      { provide: SubwayTopologyRepository, useValue: storedSubwayTopologyRepository() },
      { provide: SubwayStationCoordsRepository, useValue: storedStationCoordsRepository() },
      { provide: SubwayTimetableRepository, useValue: storedSubwayTimetableRepository() },
      { provide: JourneyRepository, useValue: journey },
      { provide: Clock, useValue: { now: () => new Date(now) } },
    ],
    role: "api",
  });
  apps.push(app);
  return app.getHttpServer();
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

type Call = Record<string, unknown> & { vehicleId: string | null; expectedArrivalAt: string | null };
type Leg = Record<string, any> & { kind: string };
type Option = Record<string, any> & { id: string; status: string; legs: Leg[] };
type Route = { id: string; options: Option[] } & Record<string, any>;

async function optionOf(server: import("http").Server, routeId: string, optionId: string): Promise<Option> {
  const res = await request(server).get("/journey/routes");
  expect(res.status).toBe(200);
  expectWire(journeyRoutes, res.body.data);
  const route = (res.body.data.routes as Route[]).find((each) => each.id === routeId)!;
  return route.options.find((option) => option.id === optionId)!;
}

/** The live route's call for `vehicleId` at the station `stopId` names, as `/bus/live/:groupId` serves it. */
async function liveCall(server: import("http").Server, groupId: string, stopId: string, vehicleId: string): Promise<Call | undefined> {
  const res = await request(server).get(`/bus/live/${groupId}`);
  expect(res.status).toBe(200);
  expectWire(liveGroup, res.body.data);
  const station = (res.body.data.stations as Array<{ stopId: string | null; arrivals: Call[] }>).find((each) => each.stopId === stopId);
  return station?.arrivals.find((arrival) => arrival.vehicleId === vehicleId);
}

const ridesOf = (option: Option) => option.legs.filter((leg) => leg.kind === "ride");

describe("GET /journey/routes with the TOPIS options", () => {
  it("A 종로 08 board equals /bus/live/jongro08's call at 100900046 for the same vehicle", async () => {
    // Arrange
    const server = await boot(at("19:00:00"));

    // Act
    const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

    // Assert
    expect(option.status).toBe("running");
    const [jongro] = ridesOf(option);
    expect(jongro).toMatchObject({ mode: "bus", line: { id: "jongro08", name: "종로 08" }, basis: "estimate" });
    expect(jongro!.board).toMatchObject({ vehicleId: "100000074", expectedArrivalAt: "2026-10-20T19:09:09+09:00", basis: "provider" });
    expect(await liveCall(server, "jongro08", "100900046", "100000074")).toEqual(jongro!.board);
  });

  it("The 사당 boarding call equals /bus/live/gyeonggi7800's at sadang-exit9 for the same vehicle", async () => {
    // Arrange
    const server = await boot(at("18:30:00"));

    // Act
    const option = await optionOf(server, "hssc-to-nsc", "line4-7800");

    // Assert
    expect(option.status).toBe("running");
    const [line4, bus7800] = ridesOf(option);
    expect(line4).toMatchObject({ mode: "subway", line: { id: "line4" } });
    expect(bus7800!.from).toMatchObject({ kind: "bus_stop", id: "sadang-exit9" });
    expect(bus7800!.board).toMatchObject({ vehicleId: "200010898", expectedArrivalAt: "2026-10-20T19:15:50+09:00" });
    expect(await liveCall(server, "gyeonggi7800", "sadang-exit9", "200010898")).toEqual(bus7800!.board);
    expect(bus7800!.vehicles).toEqual([{ id: "200010898", occupancy: null, seatsLeft: null, isLowFloor: false }]);
  });

  it("Full bus: skips the vehicle GBIS reports with no seat left and boards half a headway after the rider is ready", async () => {
    // Arrange
    const server = await boot(at("18:30:00"), {}, [{ vehicleId: "200010898", seatsLeft: 0 }]);

    // Act
    const option = await optionOf(server, "hssc-to-nsc", "line4-7800");

    // Assert
    const walk = option.legs[2]!;
    const [, bus7800] = ridesOf(option);
    expect(bus7800!.board).toMatchObject({ vehicleId: null, status: "unknown", basis: "estimate" });
    expect((Date.parse(bus7800!.board.expectedArrivalAt) - Date.parse(walk.endAt)) / 1000).toBe(60 + 300);
    expect(await liveCall(server, "gyeonggi7800", "sadang-exit9", "200010898")).toMatchObject({ vehicleId: "200010898" });
  });

  it("Past both predicted vehicles: names no vehicle and boards half the stored headway after the rider is ready, as an estimate", async () => {
    // Arrange
    const server = await boot(at("19:07:55"));

    // Act
    const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

    // Assert
    const [jongro] = ridesOf(option);
    // Ready at 19:14:55, the walk and the margin from 19:07:55; the walk is then timed back from the boarding.
    expect([option.leaveAt, option.legs[0]!.endAt]).toEqual(["2026-10-20T19:12:25+09:00", "2026-10-20T19:18:25+09:00"]);
    expect(jongro!.board).toMatchObject({ status: "unknown", vehicleId: null, runId: null, basis: "estimate", expectedArrivalAt: "2026-10-20T19:19:25+09:00" });
    expect([jongro!.basis, jongro!.vehicles]).toEqual(["estimate", []]);
  });

  it("Connection at risk: a 1호선 board within the 종로 08 headway's uncertainty warns, naming 종로5가", async () => {
    // Arrange
    const server = await boot(at("19:09:55"));

    // Act
    const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

    // Assert
    const [jongro, line1] = ridesOf(option);
    // WHY: 335 s at the platform is under the 종로 08 arrival's uncertainty, 150 s plus half its 9-minute headway (420 s).
    expect([jongro!.board.basis, jongro!.board.vehicleId, line1!.waitSec]).toEqual(["estimate", null, 335]);
    expect(option.warnings).toEqual([{ code: "connectionAtRisk", message: "종로5가역에서 갈아탈 차를 놓칠 수 있어요" }]);
  });

  it("No term: rows a poller older than the stored headway wrote serve with no extrapolation", async () => {
    // Arrange
    const server = await boot(at("19:07:55"), { jongro08: withoutServiceHours(serviceHoursDocs("jongro08", TUESDAY)) });

    // Act
    const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

    // Assert
    expect(option).toMatchObject({ status: "notRunning", reason: "ended", nextServiceAt: null, legs: [] });
  });

  it("Ended: past the pole's last run, names the next day's first run from the stored firstTm", async () => {
    // Arrange
    const server = await boot(at("23:55:00"));

    // Act
    const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

    // Assert
    expect(option).toMatchObject({ status: "notRunning", reason: "ended", nextServiceAt: "2026-10-21T06:00:00+09:00", leaveAt: null, arriveAt: null });
  });

  it("Ended: TOPIS's 운행종료 at the pole ends the day before its last run", async () => {
    // Arrange
    const ended = serviceHoursDocs("jongro08", TUESDAY).map((row) =>
      row.sequence === "4" ? { ...row, eta: "운행종료", buses: row.buses.map((bus) => ({ ...bus, arrmsg: "운행종료", vehId: "0", plainNo: " " })) } : row,
    );
    const server = await boot(at("21:00:00"), { jongro08: ended });

    // Act
    const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

    // Assert
    expect(option).toMatchObject({ status: "notRunning", reason: "ended", nextServiceAt: "2026-10-21T06:00:00+09:00" });
  });

  describe("Overnight: TOPIS answers no rows, so bus_cache holds none for 종로 08", () => {
    // WHY: the hours the poller kept on the route from the previous service day's rows, dated as TOPIS dated them.
    const keptHours = (): StationServiceHours[] =>
      serviceHoursDocs("jongro08", "2026-10-19").flatMap(({ sequence, firstTm, lastTm }) => (firstTm && lastTm ? [{ sequence: Number(sequence), firstTm, lastTm }] : []));

    it("names the morning's first run at the pole from the hours kept on the route, ended before 03:00", async () => {
      // Arrange
      const server = await boot(at("02:00:00"), { jongro08: [] }, [], keptHours());

      // Act
      const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

      // Assert
      expect(option).toMatchObject({ status: "notRunning", reason: "ended", nextServiceAt: "2026-10-20T06:00:00+09:00", legs: [] });
    });

    it("names no next service with no hours kept on the route", async () => {
      // Arrange
      const server = await boot(at("02:00:00"), { jongro08: [] });

      // Act
      const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

      // Assert
      expect(option).toMatchObject({ status: "notRunning", reason: "ended", nextServiceAt: null });
    });
  });

  describe("before the first run, every slot waiting to depart with no bus", () => {
    const waiting = () => serviceHoursDocs("jongro08", TUESDAY).map((row) => ({ ...row, eta: "출발대기", buses: row.buses.map((bus) => ({ ...bus, arrmsg: "출발대기", vehId: "0", plainNo: " ", traTime: 0, sectOrd: 0 })) }));

    it("Not started: past the plan's window, is not running, with today's first run", async () => {
      // Arrange
      const server = await boot(at("02:30:00"), { jongro08: waiting() });

      // Act
      const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

      // Assert
      expect(option).toMatchObject({ status: "notRunning", reason: "ended", nextServiceAt: "2026-10-20T06:00:00+09:00", legs: [] });
    });

    it("boards the pole's first run from TOPIS's published time once it falls inside the window", async () => {
      // Arrange
      const server = await boot(at("04:30:00"), { jongro08: waiting() });

      // Act
      const option = await optionOf(server, "hssc-to-nsc", "jongro08-line1");

      // Assert
      const [jongro] = ridesOf(option);
      expect(option.status).toBe("running");
      expect(jongro!.board).toMatchObject({ status: "scheduled", scheduledArrivalAt: "2026-10-20T06:00:00+09:00", basis: "timetable", vehicleId: null, isFirstRun: true });
      expect(option.leaveAt).toBe("2026-10-20T05:53:00+09:00");
    });
  });

  // WHY: the owner's rule that every option can show 운행종료 and its next service, checked for the sources the TOPIS
  // options ride beside the TOPIS pole itself (above): the subway timetable as a first ride, and a TOPIS ride after one.
  describe("No service, from every source a ride reads", () => {
    it.each([
      ["the 1호선 timetable, after its last train to 종로5가, before 03:00", "nsc-to-hssc", "line1-jongro08", at("01:30:00", "2026-10-21"), "ended", "2026-10-21T06:05:30+09:00"],
      ["the 7800 pole's last run, a ride after 4호선, by the 4호선 boarding that reaches it", "hssc-to-nsc", "line4-7800", at("23:40:00"), "ended", "2026-10-21T05:35:30+09:00"],
    ])("names the next service for %s", async (_case, routeId, optionId, now, reason, nextServiceAt) => {
      // Arrange
      const server = await boot(now);

      // Act
      const option = await optionOf(server, routeId, optionId);

      // Assert
      expect(option).toMatchObject({ status: "notRunning", reason, nextServiceAt, legs: [] });
    });
  });
});
