/**
 * BusDeparturesTopisService, the door for TOPIS routes (ADR 0022, D6), over a scripted live route, the stored arrival
 * rows in an in-memory bus_cache and the real stop index over the stored registry (7800 as its bootstrap stores it)
 * and the `bus-stops` revision 1 with the four proposed 7800 stops: a 7800 leg cited by its poles' station ids
 * (119000302 to 200000159) rides from station index 40 to 57, its calls the live route's for the request language,
 * and boards past them at half the stored headway of the board station's row; it throws DepartureUnavailableError
 * for a line that is no TOPIS route, a stop the route does not call at, a reversed pair, a live group placed by
 * another stations version, and a route with no stored arrival rows. Overnight, when TOPIS stores no rows, the pole's
 * next first run comes from the hours last stated for it on the route's registry document (ADR 0022 PR (h)).
 */
import { storedBusRegistryRepository, storedBusRegistryService } from "../../../../__tests__/helpers/bus/bus-registry";
import { busStopsFixture, storedBusStopsRepository, storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import { jongroArrivalDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { registryDoc7800 } from "../../../../__tests__/helpers/bus/topis-7800";
import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusLiveGroupService } from "../../../../__tests__/helpers/fakes/bus/bus-live-group.service.fake";
import { FakeBusRealtimeJongroClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRoutePathService } from "../../../../__tests__/helpers/fakes/bus/bus-route-path.service.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import proposal from "../../../../__tests__/nest/bus/fixtures/bus-stops-7800-proposal.json";
import { DepartureUnavailableError } from "../../../shared/departure.error";
import type { DepartureQuery } from "../../../shared/departure.types";
import type { Call } from "../../../shared/call.wire";
import { BusCacheService } from "../../cache/bus-cache.service";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import type { LiveGroup } from "../../live/bus-live.wire";
import type { BusLiveGroupService } from "../../live/group/bus-live-group.service";
import type { BusRealtimeJongroClient } from "../../realtime/jongro/bus-realtime-jongro.client";
import type { StationServiceHours } from "../../registry/bus-registry.document";
import { BusRealtimeJongroService } from "../../realtime/jongro/bus-realtime-jongro.service";
import type { BusRoutePathService } from "../../route-path/bus-route-path.service";
import { BusStopIndexService } from "../../stop-index/bus-stop-index.service";
import { BusDeparturesTopisService } from "./bus-departures-topis.service";

const NOW = new Date("2026-10-25T09:58:40.000Z");
const CLOCK = { now: () => NOW };
const VERSION = registryDoc7800().stationsVersion;

const call = (vehicleId: string, expectedArrivalAt: string): Call => ({
  status: "enRoute",
  ...{ expectedArrivalAt, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
  basis: "provider",
  ...{ stopsAway: 3, runId: null, vehicleId, headsign: "Toward 호매실동차고지", isFirstRun: null, isLastRun: false, isExpress: null, providerText: "3분20초후[2번째 전]" },
});

const liveGroup = (stationsVersion = VERSION): LiveGroup => ({
  groupId: "gyeonggi7800",
  stationsVersion,
  updatedAt: "2026-10-25T18:58:35+09:00",
  operation: "running",
  vehicles: [],
  stations: [
    { stationIndex: 40, stopId: "sadang-exit9", arsId: "20253", operation: "running", arrivals: [call("200011607", "2026-10-25T19:01:53+09:00")] },
    { stationIndex: 57, stopId: "nsc-skku-to-suwon", arsId: null, operation: "running", arrivals: [call("200011607", "2026-10-25T19:36:10+09:00")] },
  ],
});

const query = (extra: Partial<DepartureQuery> = {}): DepartureQuery => ({
  lineId: "gyeonggi7800",
  boardStopId: "119000302",
  alightStopId: "200000159",
  from: NOW,
  until: new Date(NOW.getTime() + 3 * 3_600_000),
  lang: "en",
  ...extra,
});

function setup({ group = liveGroup(), hasArrivals = true, hasRows = true, serviceHours = [] as StationServiceHours[] } = {}) {
  const data = busStopsFixture() as { stops: unknown[] };
  data.stops.push(...proposal.stops);
  const registry = storedBusRegistryRepository();
  registry.routes.set("gyeonggi7800", { ...registryDoc7800(), serviceHours });
  const registryService = storedBusRegistryService(registry);
  const index = new BusStopIndexService(storedBusStopsService(storedBusStopsRepository(data), CLOCK), registryService, asReal<BusRoutePathService>(new FakeBusRoutePathService()), CLOCK);
  const cache = new FakeBusCacheRepository();
  if (hasArrivals) {
    const row = jongroArrivalDoc({ stationId: "119000302", sequence: "41", term: 10, firstTm: "2026-10-25T05:52:00+09:00", lastTm: "2026-10-25T23:50:00+09:00" });
    cache.values.set("jongro_stations_7800", hasRows ? [jongroArrivalDoc({ stationId: "119000302", sequence: "40", term: 4 }), row] : []);
  }
  const cacheService = new BusCacheService(asReal<BusCacheRepository>(cache));
  const jongro = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(new FakeBusRealtimeJongroClient()), cacheService, registryService, CLOCK);
  const live = new FakeBusLiveGroupService();
  live.groups.set("gyeonggi7800", group);
  return { service: new BusDeparturesTopisService(asReal<BusLiveGroupService>(live), jongro, index), live };
}

describe("BusDeparturesTopisService.listDepartures", () => {
  it("rides 7800 from the 사당 pole to the 성균관대 pole on the live route's calls, then at half the board row's headway", async () => {
    // Arrange
    const { service, live } = setup();

    // Act
    const board = await service.listDepartures(query());

    // Assert
    expect(board.departures.map(({ board: boardCall, alight }) => [boardCall.vehicleId, boardCall.expectedArrivalAt, boardCall.headsign, alight?.expectedArrivalAt])).toEqual([
      ["200011607", new Date("2026-10-25T19:01:53+09:00"), "Toward 호매실동차고지", new Date("2026-10-25T19:36:10+09:00")],
    ]);
    expect(board.continuation).toEqual({ kind: "headway", headwaySec: 600, serviceEndsAt: new Date("2026-10-25T23:50:00+09:00") });
    expect(live.readGroupIds).toEqual(["gyeonggi7800"]);
  });

  describe("Overnight: TOPIS stores no rows, and the live route lists no arrival", () => {
    const night = (): LiveGroup => ({ ...liveGroup(), operation: "noData", stations: liveGroup().stations.map((station) => ({ ...station, operation: "noData", arrivals: [] })) });
    const AT_02_00 = new Date("2026-10-26T02:00:00+09:00");
    const HOURS_41 = { sequence: 41, firstTm: "2026-10-25T05:52:00+09:00", lastTm: "2026-10-25T23:50:00+09:00" };

    it("names the pole's next first run from the hours last stated for it on the route", async () => {
      // Arrange
      const { service } = setup({ group: night(), hasRows: false, serviceHours: [{ ...HOURS_41, sequence: 40 }, HOURS_41] });

      // Act
      const board = await service.listDepartures(query({ from: AT_02_00, until: new Date(AT_02_00.getTime() + 3 * 3_600_000) }));

      // Assert
      expect([board.departures, board.continuation, board.nextServiceAt]).toEqual([[], { kind: "listed" }, new Date("2026-10-26T05:52:00+09:00")]);
    });

    it("names none when the route holds no hours for the pole", async () => {
      // Arrange
      const { service } = setup({ group: night(), hasRows: false, serviceHours: [{ ...HOURS_41, sequence: 40 }] });

      // Act
      const board = await service.listDepartures(query({ from: AT_02_00, until: new Date(AT_02_00.getTime() + 3 * 3_600_000) }));

      // Assert
      expect(board.nextServiceAt).toBeNull();
    });
  });

  it.each([
    ["a line that is no TOPIS route", query({ lineId: "campus-inja" })],
    ["a stop the route does not call at", query({ boardStopId: "hssc-bus-lot" })],
    ["a reversed pair", query({ boardStopId: "200000159", alightStopId: "119000302" })],
  ])("throws DepartureUnavailableError for %s", async (_case, asked) => {
    // Arrange
    const { service } = setup();

    // Act
    const listed = service.listDepartures(asked);

    // Assert
    await expect(listed).rejects.toBeInstanceOf(DepartureUnavailableError);
  });

  it("throws DepartureUnavailableError when the live group's stations version is not the one the stop index placed", async () => {
    // Arrange
    const { service } = setup({ group: liveGroup("0000000000") });

    // Act & Assert
    await expect(service.listDepartures(query())).rejects.toBeInstanceOf(DepartureUnavailableError);
  });

  it("throws DepartureUnavailableError with no stored arrival rows: a stopped poller or REGIONAL_BUS off", async () => {
    // Arrange
    const { service } = setup({ hasArrivals: false });

    // Act & Assert
    await expect(service.listDepartures(query())).rejects.toThrow("no stored arrivals for gyeonggi7800");
  });
});
