/**
 * Every module `src/app.module.ts` imports, booted as the poller (ROLE=poller)
 * with every upstream client a poller calls replaced by its fake, and a fixed
 * `Clock`. The repositories stay real: the caller provides the database (a
 * test `mongod`), so a poller's reads and writes run as in production.
 *
 * A caller that strips env vars or starts `mongod` before the boot requires
 * this file only after doing so: it loads `src/`, and src/infra/config.ts reads
 * the env at import.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { BusEtaForecastClient } from "../../../src/bus/eta/forecast/bus-eta-forecast.client";
import { BusEtaProbeClient } from "../../../src/bus/eta/probe/bus-eta-probe.client";
import { BusEtaTravelClient } from "../../../src/bus/eta/travel/bus-eta-travel.client";
import { BusRealtimeGbisClient } from "../../../src/bus/realtime/gbis/bus-realtime-gbis.client";
import { BusRealtimeHsscClient } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.client";
import { BusRealtimeJongroClient } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import { BusRoutePathClient } from "../../../src/bus/route-path/bus-route-path.client";
import { Clock } from "../../../src/infra/clock";
import { MiniappsManifestClient } from "../../../src/miniapps/manifest/miniapps-manifest.client";
import { NoticesDispatchClient } from "../../../src/notices/dispatch/notices-dispatch.client";
import { SubwaySeoulApiClient } from "../../../src/subway/seoul-api/subway-seoul-api.client";
import { SubwaySeoulTrainmapClient } from "../../../src/subway/seoul-trainmap/subway-seoul-trainmap.client";
import { FakeBusEtaForecastClient } from "../fakes/bus/bus-eta-forecast.client.fake";
import { FakeBusEtaProbeClient } from "../fakes/bus/bus-eta-probe.client.fake";
import { FakeBusEtaTravelClient } from "../fakes/bus/bus-eta-travel.client.fake";
import { FakeBusRealtimeGbisClient } from "../fakes/bus/bus-realtime-gbis.client.fake";
import { FakeBusRealtimeHsscClient } from "../fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeJongroClient } from "../fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRoutePathClient } from "../fakes/bus/bus-route-path.client.fake";
import { FakeMiniappsManifestClient } from "../fakes/miniapps/miniapps-manifest.client.fake";
import { FakeNoticesDispatchClient } from "../fakes/notices/notices-dispatch.client.fake";
import { FakeSubwaySeoulApiClient } from "../fakes/subway/subway-seoul-api.client.fake";
import { FakeSubwaySeoulTrainmapClient } from "../fakes/subway/subway-seoul-trainmap.client.fake";
import { appModulesUnder } from "./app-modules";
import { buildTestApp } from "./build-test-app";

const CLOCK = { now: (): Date => new Date("2026-10-20T01:00:00Z") };

export function buildPollerApp(): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: appModulesUnder("src/"),
    overrides: [
      { provide: BusEtaForecastClient, useValue: new FakeBusEtaForecastClient() },
      { provide: BusEtaProbeClient, useValue: new FakeBusEtaProbeClient() },
      { provide: BusEtaTravelClient, useValue: new FakeBusEtaTravelClient() },
      { provide: BusRealtimeGbisClient, useValue: new FakeBusRealtimeGbisClient() },
      { provide: BusRealtimeHsscClient, useValue: new FakeBusRealtimeHsscClient() },
      { provide: BusRealtimeJongroClient, useValue: new FakeBusRealtimeJongroClient() },
      { provide: BusRoutePathClient, useValue: new FakeBusRoutePathClient() },
      { provide: MiniappsManifestClient, useValue: new FakeMiniappsManifestClient() },
      { provide: NoticesDispatchClient, useValue: new FakeNoticesDispatchClient() },
      { provide: SubwaySeoulApiClient, useValue: new FakeSubwaySeoulApiClient() },
      { provide: SubwaySeoulTrainmapClient, useValue: new FakeSubwaySeoulTrainmapClient() },
      { provide: Clock, useValue: CLOCK },
    ],
    role: "poller",
  });
}
