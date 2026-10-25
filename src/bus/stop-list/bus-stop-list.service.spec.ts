/**
 * BusStopListService over the stop index built from in-memory stores (revision 1 of `bus-stops`, the stored
 * registry and route lines): every stop named in every language as a request in it is served, a public answer
 * cached five minutes, one minute while a registry route is unread, an ETag over the body that moves with a push
 * (a catalog stop's campus, or the stop area that holds a stop),
 * and the stops' 503 when they were never read.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { capturedRoutePathOf } from "../../../__tests__/helpers/bus/bus-route-path";
import { storedBusRegistryRepository, storedBusRegistryService } from "../../../__tests__/helpers/bus/bus-registry";
import { busStopsFixture, storedBusStopsRepository, storedBusStopsService } from "../../../__tests__/helpers/bus/bus-stops";
import { FakeBusRoutePathService } from "../../../__tests__/helpers/fakes/bus/bus-route-path.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { BusRoutePathService } from "../route-path/bus-route-path.service";
import { BusStopIndexService } from "../stop-index/bus-stop-index.service";
import { BusStopListService } from "./bus-stop-list.service";

const NOW = new Date("2026-10-23T05:00:00.000Z");
// WHY: past the dataset loader's TTL (DATASET_CACHE_TTL_MS, 60 s), so the next read sees a new revision.
const PAST_DATASET_TTL_MS = 61_000;

function setup() {
  const stopsRepository = storedBusStopsRepository();
  const registryRepository = storedBusRegistryRepository();
  const routePaths = new FakeBusRoutePathService();
  routePaths.routePaths = {
    routePaths: ["02", "07", "08"].map((code) => ({ routeId: `jongro${code}`, code, ...capturedRoutePathOf(`jongro${code}`) })),
    hasMissingRoutes: false,
  };
  const clock = { now: () => new Date() };
  const index = new BusStopIndexService(storedBusStopsService(stopsRepository, clock), storedBusRegistryService(registryRepository), asReal<BusRoutePathService>(routePaths), clock);
  return { service: new BusStopListService(index), stopsRepository, registryRepository };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("BusStopListService.listStops", () => {
  it("names each stop in every language as a request in it is served: a catalog stop by its record, a pole by its Korean name", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const { data } = await service.listStops();

    // Assert
    const nameOf = (stopId: string) => data.stops.find((stop) => stop.id === stopId)?.name;
    expect(nameOf("jeongja-exit3")).toEqual({ ko: "정자역 3번 출구", en: "Jeongja Stn. Exit 3", zh: "亭子站 3号出口" });
    // WHY: the HSSC stops have no Chinese name, and a zh request is served the English one.
    expect(nameOf("hssc-hyehwa-exit1")).toEqual({ ko: "혜화역 1번출구", en: "Hyehwa Station (Shuttle Bus Stop)", zh: "Hyehwa Station (Shuttle Bus Stop)" });
    expect(nameOf("seoul-01881")).toEqual({ ko: "성균관대학교", en: "성균관대학교", zh: "성균관대학교" });
  });

  it("is public for five minutes, tagged by its body", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const first = await service.listStops();
    const second = await service.listStops();

    // Assert
    expect(first.cacheControl).toBe("public, max-age=300");
    expect(first.etag).toMatch(/^"stops-[0-9a-f]{32}"$/);
    expect(second.etag).toBe(first.etag);
  });

  it("is public for a minute while a registry route is unread", async () => {
    // Arrange
    const { service, registryRepository } = setup();
    registryRepository.routes.delete("jongro07");

    // Act
    const list = await service.listStops();

    // Assert
    expect(list.cacheControl).toBe("public, max-age=60");
    expect(list.data.stops.map((stop) => stop.id)).not.toContain("seoul-01616");
  });

  it("moves its ETag once a push files a stop under a campus", async () => {
    // Arrange
    const { service, stopsRepository } = setup();
    const before = await service.listStops();
    const pushed = busStopsFixture() as { stops: Array<{ id: string; campus?: string }> };
    pushed.stops.find((stop) => stop.id === "nsc-n-center")!.campus = "nsc";
    stopsRepository.storeStops(pushed);
    jest.setSystemTime(NOW.getTime() + PAST_DATASET_TTL_MS);

    // Act
    const after = await service.listStops();

    // Assert
    expect(before.data.stops.find((stop) => stop.id === "nsc-n-center")!.campus).toBeNull();
    expect(after.data.stops.find((stop) => stop.id === "nsc-n-center")!.campus).toBe("nsc");
    expect(after.etag).not.toBe(before.etag);
  });

  it("moves its ETag once a push groups stops into an area, and again when it changes the area's id", async () => {
    // Arrange
    const { service, stopsRepository } = setup();
    const before = await service.listStops();
    const area = { id: "hyehwa-exit1", name: { ko: "혜화역 1번 출구" }, stopIds: ["hssc-hyehwa-exit1", "seoul-01592"] };
    stopsRepository.storeStops({ ...busStopsFixture(), stopAreas: [area] });
    jest.setSystemTime(NOW.getTime() + PAST_DATASET_TTL_MS);
    const grouped = await service.listStops();
    stopsRepository.storeStops({ ...busStopsFixture(), stopAreas: [{ ...area, id: "hyehwa" }] });
    jest.setSystemTime(NOW.getTime() + 2 * PAST_DATASET_TTL_MS);

    // Act
    const renamed = await service.listStops();

    // Assert
    const areaOf = (list: typeof before, stopId: string) => list.data.stops.find((stop) => stop.id === stopId)!.stopAreaId;
    expect([areaOf(before, "seoul-01592"), areaOf(grouped, "seoul-01592"), areaOf(renamed, "hssc-hyehwa-exit1"), areaOf(renamed, "hssc-bus-lot")]).toEqual([null, "hyehwa-exit1", "hyehwa", null]);
    expect(new Set([before.etag, grouped.etag, renamed.etag]).size).toBe(3);
  });

  it("answers the stops' 503 when they were never read", async () => {
    // Arrange
    const { service, stopsRepository } = setup();
    stopsRepository.stored = null;

    // Act & Assert
    await expect(service.listStops()).rejects.toMatchObject({ code: "BUS_STOPS_UNAVAILABLE", httpStatus: 503 });
  });
});
