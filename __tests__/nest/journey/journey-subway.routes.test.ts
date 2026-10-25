/**
 * Integration over JourneyRoutesController (GET /journey/routes) and SubwayArrivalsController
 * (GET /subway/stations/:stationId/arrivals) through the production pipeline (buildTestApp), with revision 2 of
 * `journey-routes` (the 인자셔틀 options plus 4호선 → 금정 → 1호선 each way) and the trimmed `subway-timetables`
 * fixture of revision 1, no subway state stored, so every board serves its timetable trains: on a Tuesday morning the
 * subway option walks to 혜화, rides line 4 to 금정, transfers, rides line 1 to 성균관대 and walks to 정문, each ride
 * on the first train catchable a catch margin after the legs before it, and ending at its train's arrival; and each ride's board and alight calls equal the
 * calls the station boards serve for the same run at both platforms, read when each board lists that train (ADR 0022,
 * D1 and D2).
 *
 * Every store is in memory, as in journey-routes.routes.test.ts; the pollers never start (ROLE=api), and each clock
 * instant boots its own app.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BuildingModule } from "../../../src/building/building.module";
import { BuildingRepository } from "../../../src/building/building.repository";
import { BusModule } from "../../../src/bus/bus.module";
import { BusCacheModule } from "../../../src/bus/cache/bus-cache.module";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusDeparturesTimetableModule } from "../../../src/bus/departures/timetable/bus-departures-timetable.module";
import { BusEtaModule } from "../../../src/bus/eta/bus-eta.module";
import { BusEtaRepository } from "../../../src/bus/eta/bus-eta.repository";
import { BusEtaSmartModule } from "../../../src/bus/eta/smart/bus-eta-smart.module";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeHsscClient } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.client";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeJongroClient } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroModule } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.module";
import { BusRegistryModule } from "../../../src/bus/registry/bus-registry.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
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
import { SubwayArrivalsModule } from "../../../src/subway/arrivals/subway-arrivals.module";
import { SubwayEstimateModule } from "../../../src/subway/estimate/subway-estimate.module";
import { SubwayPlatformArrivalsModule } from "../../../src/subway/platform-arrivals/subway-platform-arrivals.module";
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
import { SubwayTrackingModule } from "../../../src/subway/tracking/subway-tracking.module";
import { storedBuilding } from "../../helpers/building/buildings";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { storedScheduleContentRepository } from "../../helpers/bus/schedule-content";
import { storedCalendarRepository } from "../../helpers/calendar/rest-days";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusEtaRepository } from "../../helpers/fakes/bus/bus-eta.repository.fake";
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

// WHY: Tuesday 2026-10-20 07:40 KST, inside the trimmed fixture's weekday morning on both lines.
const AT_07_40_KST = new Date("2026-10-19T22:40:00.000Z");
const MINUTE_MS = 60_000;

const { _about: journeyAbout, ...revision2 } = require("./fixtures/journey-routes-revision-2.dataset.json") as Record<string, unknown>;
void journeyAbout;

const gate = (id: number, campus: "hssc" | "nsc", lng: number, lat: number) =>
  storedBuilding({ _id: id, buildNo: null, campus, type: "facility", name: { ko: "정문", en: "Main Gate" }, location: { type: "Point", coordinates: [lng, lat] } });

const apps: NestExpressApplication[] = [];

async function boot(now: Date): Promise<import("http").Server> {
  const journey = new FakeJourneyRepository();
  journey.storeRoutes(revision2);
  const buildings = new FakeBuildingRepository();
  buildings.buildings = [gate(1, "hssc", 126.997131, 37.584865), gate(7, "nsc", 126.974074, 37.290649)];
  const app = await buildTestApp({
    imports: [
      SchedulingModule,
      CalendarModule,
      ...[BusModule, BusCacheModule, BusRegistryModule, BusRoutePathModule, BusRealtimeModule, BusRealtimeHsscModule, BusRealtimeJongroModule],
      ...[BusStopsModule, BusScheduleContentModule, BusScheduleModule, BusEtaModule, BusEtaSmartModule, BusStopIndexModule],
      ...[BuildingModule, SubwayModule, SubwayStationsModule, SubwayTopologyModule, SubwayStationCoordsModule, SubwayTimetableModule],
      ...[SubwayEstimateModule, SubwayTrackingModule, SubwayPlatformArrivalsModule, SubwayArrivalsModule, SubwayTimetableDeparturesModule],
      ...[BusDeparturesTimetableModule, JourneyModule, JourneyDeparturesModule, JourneyPlacesModule, JourneyRoutesModule],
    ],
    overrides: [
      { provide: BusCacheRepository, useValue: new FakeBusCacheRepository() },
      { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
      { provide: BusRoutePathClient, useValue: new FakeBusRoutePathClient() },
      { provide: BusRealtimeHsscClient, useValue: new FakeBusRealtimeHsscClient() },
      { provide: BusRealtimeJongroClient, useValue: new FakeBusRealtimeJongroClient() },
      { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
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

type Call = Record<string, unknown> & { runId: string | null; scheduledArrivalAt: string | null; scheduledDepartureAt: string | null };
type Leg = Record<string, any> & { kind: string };
type Option = Record<string, any> & { id: string; legs: Leg[] };
type Route = { id: string; options: Option[] } & Record<string, any>;

async function subwayOption(server: import("http").Server, routeId: string, optionId: string): Promise<Option> {
  const res = await request(server).get("/journey/routes");
  expect(res.status).toBe(200);
  expectWire(journeyRoutes, res.body.data);
  const route = (res.body.data.routes as Route[]).find((each) => each.id === routeId)!;
  return route.options.find((option) => option.id === optionId)!;
}

/** The station board's call for `runId` at `platformId`, read a minute before `call`'s time there, without its train number. */
async function stationBoardCall(stationId: string, platformId: string, call: Call): Promise<Call | undefined> {
  const at = new Date(Date.parse(call.scheduledDepartureAt ?? call.scheduledArrivalAt ?? "") - MINUTE_MS);
  const res = await request(await boot(at)).get(`/subway/stations/${stationId}/arrivals`);
  const line = (res.body.data.lines as Array<{ platformId: string; directions: Array<{ trains: Array<Call & { trainNo: string }> }> }>).find((each) => each.platformId === platformId);
  const found = line?.directions.flatMap((direction) => direction.trains).find((train) => train.runId === call.runId);
  if (!found) return undefined;
  const served: Partial<typeof found> = { ...found };
  delete served.trainNo;
  return served as Call;
}

describe("GET /journey/routes with the subway options", () => {
  it("rides 4호선 from 혜화 to 금정, transfers, and rides 1호선 to 성균관대 on the first catchable trains", async () => {
    // Arrange
    const server = await boot(AT_07_40_KST);

    // Act
    const option = await subwayOption(server, "hssc-to-nsc", "line4-line1");

    // Assert
    expect([option.status, option.leaveAt, option.arriveAt]).toEqual(["running", "2026-10-20T07:44:30+09:00", "2026-10-20T09:21:00+09:00"]);
    expect(option.legs.map((leg) => [leg.kind, leg.mode, leg.from.id, leg.from.platformId, leg.to.id, leg.to.platformId, leg.startAt, leg.endAt, leg.basis])).toEqual([
      ["walk", "walk", "1", null, "hyehwa", null, "2026-10-20T07:44:30+09:00", "2026-10-20T07:52:30+09:00", "estimate"],
      ["ride", "subway", "hyehwa", "S1-4-420", "geumjeong", "KR-4-443", "2026-10-20T07:53:30+09:00", "2026-10-20T08:46:00+09:00", "timetable"],
      ["transfer", "subway", "geumjeong", "KR-4-443", "geumjeong", "KR-1-P149", "2026-10-20T08:46:00+09:00", "2026-10-20T08:47:00+09:00", "estimate"],
      ["ride", "subway", "geumjeong", "KR-1-P149", "sungkyunkwan", "KR-1-P153", "2026-10-20T08:49:00+09:00", "2026-10-20T08:58:00+09:00", "timetable"],
      ["walk", "walk", "sungkyunkwan", null, "7", null, "2026-10-20T08:58:00+09:00", "2026-10-20T09:21:00+09:00", "estimate"],
    ]);
    expect(option.legs.filter((leg) => leg.kind === "ride").map((leg) => [leg.line.name, leg.board.runId, leg.board.isExpress])).toEqual([
      ["4호선", "4/2026-10-20/4305", false],
      ["1호선", "1/2026-10-20/1907", true],
    ]);
  });

  it("A subway ride's board and alight calls equal the station boards' calls for the same run at both platforms", async () => {
    // Arrange
    const server = await boot(AT_07_40_KST);
    const option = await subwayOption(server, "hssc-to-nsc", "line4-line1");
    const [line4, line1] = option.legs.filter((leg) => leg.kind === "ride") as Array<Leg & { board: Call; alight: Call }>;

    // Act
    const boards = [
      await stationBoardCall("hyehwa", "S1-4-420", line4!.board),
      await stationBoardCall("geumjeong", "KR-4-443", line4!.alight),
      await stationBoardCall("geumjeong", "KR-1-P149", line1!.board),
      await stationBoardCall("sungkyunkwan", "KR-1-P153", line1!.alight),
    ];

    // Assert
    expect(boards).toEqual([line4!.board, line4!.alight, line1!.board, line1!.alight]);
    expect(line4!.alight).toMatchObject({ runId: line4!.board.runId, basis: "timetable", status: "scheduled", scheduledArrivalAt: "2026-10-20T08:46:00+09:00" });
  });
});
