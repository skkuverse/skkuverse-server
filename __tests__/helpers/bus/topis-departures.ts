/**
 * A BusDeparturesTopisService, the TOPIS door of the journey (ADR 0022, D6), over a scripted live route, the arrival
 * rows a test stores in an in-memory bus_cache, and the real stop index and registry over the stored `bus-stops` and
 * `jongro_routes` (revision 1 and the 2026-10-17 capture by default), which a spec of a reader of the door builds on.
 */
import { BusCacheService } from "../../../src/bus/cache/bus-cache.service";
import type { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusDeparturesTopisService } from "../../../src/bus/departures/topis/bus-departures-topis.service";
import type { BusLiveGroupService } from "../../../src/bus/live/group/bus-live-group.service";
import type { BusRealtimeJongroClient } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroService } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.service";
import type { BusRegistryService } from "../../../src/bus/registry/bus-registry.service";
import type { BusRoutePathService } from "../../../src/bus/route-path/bus-route-path.service";
import type { BusStopsService } from "../../../src/bus/stops/bus-stops.service";
import { BusStopIndexService } from "../../../src/bus/stop-index/bus-stop-index.service";
import type { Clock } from "../../../src/infra/clock";
import { FakeBusCacheRepository } from "../fakes/bus/bus-cache.repository.fake";
import { FakeBusLiveGroupService } from "../fakes/bus/bus-live-group.service.fake";
import { FakeBusRealtimeJongroClient } from "../fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRoutePathService } from "../fakes/bus/bus-route-path.service.fake";
import { asReal } from "../fakes/public-of";
import { storedBusRegistryService } from "./bus-registry";
import { storedBusStopsService } from "./bus-stops";

export interface TopisDeparturesParts {
  live?: FakeBusLiveGroupService;
  cache?: FakeBusCacheRepository;
  stops?: BusStopsService;
  registry?: BusRegistryService;
  clock: Clock;
}

export function topisDepartures({ live = new FakeBusLiveGroupService(), cache = new FakeBusCacheRepository(), stops, registry = storedBusRegistryService(), clock }: TopisDeparturesParts): BusDeparturesTopisService {
  const routePaths = asReal<BusRoutePathService>(new FakeBusRoutePathService());
  const index = new BusStopIndexService(stops ?? storedBusStopsService(undefined, clock), registry, routePaths, clock);
  const cacheService = new BusCacheService(asReal<BusCacheRepository>(cache));
  const jongro = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(new FakeBusRealtimeJongroClient()), cacheService, registry, clock);
  return new BusDeparturesTopisService(asReal<BusLiveGroupService>(live), jongro, index, routePaths);
}
