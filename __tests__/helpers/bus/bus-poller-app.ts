/**
 * Every module `src/app.module.ts` imports under `src/scheduling/` and
 * `src/bus/`, booted as the poller (ROLE=poller) with every upstream client a
 * bus poller calls replaced by a fake, NAVER and TOPIS by the caller's, TMAP by
 * the caller's when given, and the caller's `Clock`. The repositories stay
 * real: the caller provides the database (a test `mongod`), so a poller's
 * reads and writes run as in production.
 *
 * A caller requires this file only after starting `mongod`: it loads `src/`,
 * and src/infra/config.ts reads the env at import.
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
import { FakeBusEtaForecastClient } from "../fakes/bus/bus-eta-forecast.client.fake";
import type { FakeBusEtaProbeClient } from "../fakes/bus/bus-eta-probe.client.fake";
import type { FakeBusEtaTravelClient } from "../fakes/bus/bus-eta-travel.client.fake";
import { FakeBusRealtimeGbisClient } from "../fakes/bus/bus-realtime-gbis.client.fake";
import { FakeBusRealtimeHsscClient } from "../fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeJongroClient } from "../fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRoutePathClient } from "../fakes/bus/bus-route-path.client.fake";
import { appModulesUnder } from "../nest/app-modules";
import { buildTestApp } from "../nest/build-test-app";

export interface BusPollerUpstreams {
  naver: FakeBusEtaTravelClient;
  topis: FakeBusEtaProbeClient;
  tmap?: FakeBusEtaForecastClient;
  clock: Clock;
}

export function buildBusPollerApp({ naver, topis, tmap = new FakeBusEtaForecastClient(), clock }: BusPollerUpstreams): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/bus/"),
    overrides: [
      { provide: BusEtaForecastClient, useValue: tmap },
      { provide: BusEtaProbeClient, useValue: topis },
      { provide: BusEtaTravelClient, useValue: naver },
      { provide: BusRealtimeGbisClient, useValue: new FakeBusRealtimeGbisClient() },
      { provide: BusRealtimeHsscClient, useValue: new FakeBusRealtimeHsscClient() },
      { provide: BusRealtimeJongroClient, useValue: new FakeBusRealtimeJongroClient() },
      { provide: BusRoutePathClient, useValue: new FakeBusRoutePathClient() },
      { provide: Clock, useValue: clock },
    ],
    role: "poller",
  });
}
