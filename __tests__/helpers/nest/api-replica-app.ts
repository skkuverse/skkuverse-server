/**
 * Every module `src/app.module.ts` imports, booted as an api replica (ROLE=api)
 * with the repositories the bus, subway and map read routes reach replaced by
 * fakes holding production-shaped data, the mini app manifest client by its
 * fake, and a fixed `Clock`. The other repositories stay real: an api replica
 * touches no database at boot (ADR 0012, D3), and the routes a caller requests
 * must not reach them.
 *
 * A caller that strips env vars before the boot requires this file only after
 * doing so: it loads `src/`, and src/infra/config.ts reads the env at import.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { HolidaysRepository } from "../../../src/holidays/holidays.repository";
import { Clock } from "../../../src/infra/clock";
import { MapRepository } from "../../../src/map/map.repository";
import { MiniappsCatalogClient } from "../../../src/miniapps/catalog/miniapps-catalog.client";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import { storedBusRegistryRepository } from "../bus/bus-registry";
import { storedBusRoutePathRepository } from "../bus/bus-route-path";
import { FakeBusCacheRepository } from "../fakes/bus/bus-cache.repository.fake";
import { FakeHolidaysRepository } from "../fakes/holidays/holidays.repository.fake";
import { FakeMapRepository } from "../fakes/map/map.repository.fake";
import { FakeMiniappsCatalogClient } from "../fakes/miniapps/miniapps-catalog.client.fake";
import { FakeSubwayRepository } from "../fakes/subway/subway.repository.fake";
import { appModulesUnder } from "./app-modules";
import { buildTestApp } from "./build-test-app";

const CLOCK = { now: (): Date => new Date("2026-10-20T01:00:00Z") };

export function buildApiReplicaApp(): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: appModulesUnder("src/"),
    overrides: [
      { provide: BusCacheRepository, useValue: new FakeBusCacheRepository() },
      { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
      { provide: HolidaysRepository, useValue: new FakeHolidaysRepository() },
      { provide: MapRepository, useValue: new FakeMapRepository() },
      { provide: MiniappsCatalogClient, useValue: new FakeMiniappsCatalogClient() },
      { provide: SubwayRepository, useValue: new FakeSubwayRepository() },
      { provide: Clock, useValue: CLOCK },
    ],
    role: "api",
  });
}
