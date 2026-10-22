/**
 * BusLiveJongroService over the realtime view built on an in-memory bus_cache and the stored registry, attributes
 * and stops: a Jongno route's cached rows and positions become its live group, its stations named by the stops'
 * aliases; a group that is no Jongno route is none of its.
 */
import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeHsscRepository } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.repository.fake";
import { FakeBusRealtimeJongroClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { jongroArrivalBus, jongroArrivalDoc, jongroPositionDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { storedBusRegistryService } from "../../../../__tests__/helpers/bus/bus-registry";
import { storedRouteAttributesService } from "../../../../__tests__/helpers/bus/route-attributes";
import { busStopsFixture, storedBusStopsRepository, storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import type { Clock } from "../../../infra/clock";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import { BusCacheService } from "../../cache/bus-cache.service";
import { BusRealtimeArrivalService } from "../../realtime/arrival/bus-realtime-arrival.service";
import { BusRealtimeGroupService } from "../../realtime/group/bus-realtime-group.service";
import type { BusRealtimeHsscClient } from "../../realtime/hssc/bus-realtime-hssc.client";
import type { BusRealtimeHsscRepository } from "../../realtime/hssc/bus-realtime-hssc.repository";
import { BusRealtimeHsscService } from "../../realtime/hssc/bus-realtime-hssc.service";
import type { BusRealtimeJongroClient } from "../../realtime/jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroService } from "../../realtime/jongro/bus-realtime-jongro.service";
import { BusLiveJongroService } from "./bus-live-jongro.service";

const clock: Clock = { now: () => new Date("2026-10-20T01:00:00Z") };

function service(busCache: FakeBusCacheRepository, stops = storedBusStopsService()): BusLiveJongroService {
  const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
  const hssc = new BusRealtimeHsscService(asReal<BusRealtimeHsscClient>(new FakeBusRealtimeHsscClient()), cache, asReal<BusRealtimeHsscRepository>(new FakeBusRealtimeHsscRepository()), clock);
  const jongro = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(new FakeBusRealtimeJongroClient()), cache, storedBusRegistryService(), clock);
  const realtime = new BusRealtimeGroupService(hssc, jongro, new BusRealtimeArrivalService(storedRouteAttributesService()), clock);
  return new BusLiveJongroService(realtime, stops);
}

describe("BusLiveJongroService.findLiveGroup", () => {
  it("serves a Jongno route's cached rows and positions as its live group", async () => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    busCache.values.set("jongro_locations_07", [jongroPositionDoc({ sequence: "6" })]);
    busCache.values.set("jongro_stations_07", [jongroArrivalDoc({ stationId: "100900220", sequence: "1", buses: [jongroArrivalBus({ staOrd: 1, sectOrd: 0 })] })]);

    // Act
    const group = await service(busCache).findLiveGroup("jongro07");

    // Assert
    expect(group).toMatchObject({ groupId: "jongro07", operation: "running", updatedAt: "2026-10-20T10:00:00+09:00" });
    expect(group!.vehicles.map(({ id, plateNumber }) => [id, plateNumber])).toEqual([["100000103", "서울74사5537"]]);
    expect(group!.stations.map(({ stationIndex, stopId, arsId }) => [stationIndex, stopId, arsId])).toEqual([[0, "seoul-01617", "01617"]]);
  });

  it("names a pole a local stop aliases by that stop", async () => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    busCache.values.set("jongro_stations_07", [jongroArrivalDoc({ stationId: "100900220", sequence: "1" })]);
    const data = busStopsFixture() as { stops: Array<{ id: string; arsIds?: string[] }> };
    data.stops[0]!.arsIds = ["01617"];

    // Act
    const group = await service(busCache, storedBusStopsService(storedBusStopsRepository(data))).findLiveGroup("jongro07");

    // Assert
    expect(group!.stations[0]!.stopId).toBe(data.stops[0]!.id);
  });

  it("answers null for a group that is no Jongno route", async () => {
    // Act & Assert
    expect(await service(new FakeBusCacheRepository()).findLiveGroup("hssc")).toBeNull();
  });
});
