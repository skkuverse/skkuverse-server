/**
 * Every module `src/app.module.ts` imports, booted as an api replica (ROLE=api)
 * with the repositories the bus, subway and map read routes reach replaced by
 * fakes holding production-shaped data (the subway topology, timetables and station coords included), the mini app manifest client and
 * the stored manifests by their fakes, and a fixed `Clock`. The other repositories stay real: an api replica
 * touches no database at boot (ADR 0012, D3), and the routes a caller requests
 * must not reach them.
 *
 * A caller that strips env vars before the boot requires this file only after
 * doing so: it loads `src/`, and src/infra/config.ts reads the env at import.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusHsscRouteLineRepository } from "../../../src/bus/hssc-route-line/bus-hssc-route-line.repository";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { Clock } from "../../../src/infra/clock";
import { MapRepository } from "../../../src/map/map.repository";
import { MiniappsManifestClient } from "../../../src/miniapps/manifest/miniapps-manifest.client";
import { MiniappsManifestRepository } from "../../../src/miniapps/manifest/miniapps-manifest.repository";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import { SubwayTopologyRepository } from "../../../src/subway/topology/subway-topology.repository";
import { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import { storedStationCoordsRepository } from "../subway/station-coords";
import { SubwayTimetableRepository } from "../../../src/subway/timetable/subway-timetable.repository";
import { storedBusRegistryRepository } from "../bus/bus-registry";
import { storedBusStopsRepository } from "../bus/bus-stops";
import { storedRouteAttributesRepository } from "../bus/route-attributes";
import { storedBusRoutePathRepository } from "../bus/bus-route-path";
import { storedHsscRouteLineRepository } from "../bus/hssc-route-line";
import { FakeBusCacheRepository } from "../fakes/bus/bus-cache.repository.fake";
import { storedCalendarRepository } from "../calendar/rest-days";
import { FakeMapRepository } from "../fakes/map/map.repository.fake";
import { FakeMiniappsManifestClient } from "../fakes/miniapps/miniapps-manifest.client.fake";
import { FakeMiniappsManifestRepository } from "../fakes/miniapps/miniapps-manifest.repository.fake";
import { FakeSubwayRepository } from "../fakes/subway/subway.repository.fake";
import { storedSubwayTopologyRepository } from "../subway/topology";
import { storedSubwayTimetableRepository } from "../subway/timetables";
import { appModulesUnder } from "./app-modules";
import { buildTestApp } from "./build-test-app";

const CLOCK = { now: (): Date => new Date("2026-10-20T01:00:00Z") };

export function buildApiReplicaApp(): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: appModulesUnder("src/"),
    overrides: [
      { provide: BusCacheRepository, useValue: new FakeBusCacheRepository() },
      { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
      { provide: BusHsscRouteLineRepository, useValue: storedHsscRouteLineRepository() },
      { provide: CalendarRepository, useValue: storedCalendarRepository() },
      { provide: MapRepository, useValue: new FakeMapRepository() },
      { provide: MiniappsManifestClient, useValue: new FakeMiniappsManifestClient() },
      { provide: MiniappsManifestRepository, useValue: new FakeMiniappsManifestRepository() },
      { provide: SubwayRepository, useValue: new FakeSubwayRepository() },
      { provide: SubwayTopologyRepository, useValue: storedSubwayTopologyRepository() },
      { provide: SubwayStationCoordsRepository, useValue: storedStationCoordsRepository() },
      { provide: SubwayTimetableRepository, useValue: storedSubwayTimetableRepository() },
      { provide: Clock, useValue: CLOCK },
    ],
    role: "api",
  });
}
