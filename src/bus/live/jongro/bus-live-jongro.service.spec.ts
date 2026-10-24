/**
 * BusLiveJongroService over the realtime view built on an in-memory bus_cache and the stored registry, attributes
 * and stops: a Jongno route's cached rows and positions become its live group, its stations named by the stops'
 * aliases; a group that is no Jongno route is none of its. 7800's vehicles take the seats left a GBIS answer at most
 * 200 s old gives their ids (ADR 0019, D17), and none past that; a Jongno route reads no seats at all.
 */
import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeGbisClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-gbis.client.fake";
import { FakeBusRealtimeGbisRepository } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-gbis.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeHsscRepository } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.repository.fake";
import { FakeBusRealtimeJongroClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { jongroArrivalBus, jongroArrivalDoc, jongroPositionDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { storedBusRegistryRepository, storedBusRegistryService } from "../../../../__tests__/helpers/bus/bus-registry";
import { ROUTE_7800, arrivalDocs7800, registryDoc7800, sightings7800 } from "../../../../__tests__/helpers/bus/topis-7800";
import { storedRouteAttributesService } from "../../../../__tests__/helpers/bus/route-attributes";
import { busStopsFixture, storedBusStopsRepository, storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import type { Clock } from "../../../infra/clock";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import { BusCacheService } from "../../cache/bus-cache.service";
import { BusRealtimeArrivalService } from "../../realtime/arrival/bus-realtime-arrival.service";
import type { BusRealtimeGbisClient } from "../../realtime/gbis/bus-realtime-gbis.client";
import type { BusRealtimeGbisRepository } from "../../realtime/gbis/bus-realtime-gbis.repository";
import { BusRealtimeGbisService } from "../../realtime/gbis/bus-realtime-gbis.service";
import { BusRealtimeGroupService } from "../../realtime/group/bus-realtime-group.service";
import type { BusRealtimeHsscClient } from "../../realtime/hssc/bus-realtime-hssc.client";
import type { BusRealtimeHsscRepository } from "../../realtime/hssc/bus-realtime-hssc.repository";
import { BusRealtimeHsscService } from "../../realtime/hssc/bus-realtime-hssc.service";
import type { BusRealtimeJongroClient } from "../../realtime/jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroService } from "../../realtime/jongro/bus-realtime-jongro.service";
import { BusLiveJongroService } from "./bus-live-jongro.service";

const clock: Clock = { now: () => new Date("2026-10-20T01:00:00Z") };

interface Upstreams {
  stops?: ReturnType<typeof storedBusStopsService>;
  seats?: FakeBusRealtimeGbisRepository;
  registry?: ReturnType<typeof storedBusRegistryRepository>;
  at?: Clock;
}

function service(busCache: FakeBusCacheRepository, { stops = storedBusStopsService(), seats = new FakeBusRealtimeGbisRepository(), registry = storedBusRegistryRepository(), at = clock }: Upstreams = {}): BusLiveJongroService {
  const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
  const hssc = new BusRealtimeHsscService(asReal<BusRealtimeHsscClient>(new FakeBusRealtimeHsscClient()), cache, asReal<BusRealtimeHsscRepository>(new FakeBusRealtimeHsscRepository()), at);
  const jongro = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(new FakeBusRealtimeJongroClient()), cache, storedBusRegistryService(registry), at);
  const realtime = new BusRealtimeGroupService(hssc, jongro, new BusRealtimeArrivalService(storedRouteAttributesService()), at);
  const gbis = new BusRealtimeGbisService(asReal<BusRealtimeGbisClient>(new FakeBusRealtimeGbisClient()), asReal<BusRealtimeGbisRepository>(seats), at);
  return new BusLiveJongroService(realtime, stops, gbis);
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
    const group = await service(busCache, { stops: storedBusStopsService(storedBusStopsRepository(data)) }).findLiveGroup("jongro07");

    // Assert
    expect(group!.stations[0]!.stopId).toBe(data.stops[0]!.id);
  });

  it("answers null for a group that is no Jongno route", async () => {
    // Act & Assert
    expect(await service(new FakeBusCacheRepository()).findLiveGroup("hssc")).toBeNull();
  });

  it("reads no seats for a Jongno route, serving each vehicle's as null", async () => {
    // Arrange
    const busCache = new FakeBusCacheRepository();
    busCache.values.set("jongro_locations_07", [jongroPositionDoc({ sequence: "6" })]);
    const seats = new FakeBusRealtimeGbisRepository();
    seats.seatsByRouteId.set("jongro07", { _id: "jongro07", seats: [{ vehicleId: "100000103", seatsLeft: 9 }], checkedAt: clock.now() });

    // Act
    const group = await service(busCache, { seats }).findLiveGroup("jongro07");

    // Assert
    expect(group!.vehicles.map(({ id, seatsLeft }) => [id, seatsLeft])).toEqual([["100000103", null]]);
    expect(seats.reads).toBe(0);
  });
});

describe("BusLiveJongroService.findLiveGroup seats on 7800", () => {
  // 17:51:10 KST, ten seconds after the TOPIS capture the 7800 poller stored.
  const NOW = new Date("2026-10-24T08:51:10Z");
  const at: Clock = { now: () => NOW };
  const SEATS = [
    { vehicleId: "233000041", seatsLeft: 70 },
    { vehicleId: "233000031", seatsLeft: 0 },
    { vehicleId: "299999999", seatsLeft: 12 },
  ];

  async function live7800(checkedAt: Date) {
    const busCache = new FakeBusCacheRepository();
    busCache.writtenAt = NOW;
    const registry = storedBusRegistryRepository();
    registry.routes.set(ROUTE_7800.id, registryDoc7800());
    const client = new FakeBusRealtimeJongroClient();
    client.arrivals = arrivalDocs7800();
    client.sightings = sightings7800();
    await new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(client), new BusCacheService(asReal<BusCacheRepository>(busCache)), storedBusRegistryService(registry), at).refresh(ROUTE_7800);
    const seats = new FakeBusRealtimeGbisRepository();
    seats.seatsByRouteId.set(ROUTE_7800.id, { _id: ROUTE_7800.id, seats: SEATS, checkedAt });
    return service(busCache, { seats, registry, at }).findLiveGroup(ROUTE_7800.id);
  }

  it("joins a fresh answer's seats left to the vehicles by id, 0 included, and null for every other vehicle", async () => {
    // Act
    const group = await live7800(new Date(NOW.getTime() - 90_000));

    // Assert
    const seated = group!.vehicles.filter(({ seatsLeft }) => seatsLeft !== null).map(({ id, seatsLeft }) => [id, seatsLeft]);
    expect(seated).toEqual([
      ["233000041", 70],
      ["233000031", 0],
    ]);
    expect(group!.vehicles.length).toBeGreaterThan(2);
  });

  it("serves every vehicle's seats as null from an answer past its bound", async () => {
    // Act
    const group = await live7800(new Date(NOW.getTime() - 200_001));

    // Assert
    expect(group!.vehicles.filter(({ seatsLeft }) => seatsLeft !== null)).toEqual([]);
  });
});
