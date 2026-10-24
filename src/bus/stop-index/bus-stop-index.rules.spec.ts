/**
 * The stop index: which served routes stop at each
 * stop, derived from one `bus-stops` snapshot and the stored Jongno registry, and never stored. A TOPIS pole's stop
 * id is `seoul-<arsId>` of its stored station, a virtual stop (ARS `0` or empty) has none, a pole two routes share is
 * one stop, a route that lists a pole twice serves it at its first index, an alias makes a pole part of its local
 * stop, each HSSC position and sequence stop maps to its entry, and the routes follow the order of `/bus/config`.
 *
 * Built over revision 1 of `bus-stops` and the registry production stored on 2026-10-17
 * (__tests__/helpers/bus/), with a copy changed where a case needs other data. A pole's stop id is the bus root's
 * `toPoleStopId`, which `/bus/config` serves too; ported (old → new): `toTopisStopId` "prefixes the ARS
 * number" → src/bus/bus.rules.spec.ts `toPoleStopId`.
 */
import { storedBusRegistryRepository, storedBusRegistryService } from "../../../__tests__/helpers/bus/bus-registry";
import { busStopsFixture, storedBusStopsRepository, storedBusStopsService } from "../../../__tests__/helpers/bus/bus-stops";
import type { RegistryRoute } from "../registry/bus-registry.types";
import type { BusStopsSnapshot } from "../stops/bus-stops.types";
import { hasPoleAliases, toPoleArsId, toStopIndex } from "./bus-stop-index.rules";

type FixtureStop = { id: string; arsIds?: string[]; topisIds?: string[] };

async function snapshotOf(edit: (data: { stops: FixtureStop[] }) => void = () => undefined): Promise<BusStopsSnapshot> {
  const data = busStopsFixture() as unknown as { stops: FixtureStop[] };
  edit(data);
  return storedBusStopsService(storedBusStopsRepository(data)).current();
}

async function routesOf(edit: (repository: ReturnType<typeof storedBusRegistryRepository>) => void = () => undefined): Promise<RegistryRoute[]> {
  const repository = storedBusRegistryRepository();
  edit(repository);
  return storedBusRegistryService(repository).listRoutes();
}

const versionOf = (routes: RegistryRoute[], routeId: string) => routes.find((route) => route.id === routeId)!.stationsVersion;
const routesAt = (index: ReturnType<typeof toStopIndex>, stopId: string) => index.stopById.get(stopId)?.routes;

describe("toPoleArsId", () => {
  it.each([
    ["seoul-01592", "01592"],
    ["seoul-1592", null],
    ["seoul-015920", null],
    ["hssc-bus-lot", null],
    ["seoul-", null],
  ])("reads %s as %s", (stopId, arsId) => {
    // Act & Assert
    expect(toPoleArsId(stopId)).toBe(arsId);
  });
});

describe("hasPoleAliases", () => {
  it.each([
    ["hssc-bus-lot", ["01618"], true],
    ["hssc-bus-lot", [], false],
    ["hssc-bus-lot", undefined, false],
    ["hssc-nowhere", ["01618"], false],
  ])("reads %s with arsIds %j as %s", async (stopId, arsIds, expected) => {
    // Arrange
    const snapshot = await snapshotOf((data) => {
      if (arsIds !== undefined) data.stops.find((stop) => stop.id === "hssc-bus-lot")!.arsIds = arsIds;
    });

    // Act & Assert
    expect(hasPoleAliases(snapshot, stopId)).toBe(expected);
  });

  it.each([
    [["200000162"], true],
    [[], false],
  ])("reads hssc-bus-lot with topisIds %j and no arsIds as %s", async (topisIds, expected) => {
    // Arrange
    const snapshot = await snapshotOf((data) => {
      data.stops.find((stop) => stop.id === "hssc-bus-lot")!.topisIds = topisIds;
    });

    // Act & Assert
    expect(hasPoleAliases(snapshot, "hssc-bus-lot")).toBe(expected);
  });
});

describe("toStopIndex", () => {
  it("maps each stored station with an ARS number to its route and index, and 07 and 08 share seoul-01592", async () => {
    // Arrange
    const [snapshot, routes] = await Promise.all([snapshotOf(), routesOf()]);

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "seoul-01592")).toEqual([
      { kind: "jongro", groupId: "jongro07", stationIndex: 16, towards: "혜화동로터리", stationsVersion: versionOf(routes, "jongro07") },
      { kind: "jongro", groupId: "jongro08", stationIndex: 22, towards: "혜화동로터리", stationsVersion: versionOf(routes, "jongro08") },
    ]);
    expect(index.stopById.get("seoul-01592")).toMatchObject({ id: "seoul-01592", localStop: null, poles: [{ arsId: "01592", topisId: "100900075", stationName: "혜화역1번출구" }] });
    expect(index.stopIdByArsId.get("01592")).toBe("seoul-01592");
  });

  it("keeps two poles of one name across a road apart", async () => {
    // Arrange
    const [snapshot, routes] = await Promise.all([snapshotOf(), routesOf()]);

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "seoul-01722")).toEqual([{ kind: "jongro", groupId: "jongro07", stationIndex: 3, towards: "유림회관앞", stationsVersion: versionOf(routes, "jongro07") }]);
    expect(routesAt(index, "seoul-01615")).toEqual([{ kind: "jongro", groupId: "jongro07", stationIndex: 19, towards: "비천당", stationsVersion: versionOf(routes, "jongro07") }]);
  });

  it("serves 02's repeated terminal 01881 at index 0 only", async () => {
    // Arrange
    const [snapshot, routes] = await Promise.all([snapshotOf(), routesOf()]);

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "seoul-01881")).toEqual([{ kind: "jongro", groupId: "jongro02", stationIndex: 0, towards: "서울성곽.성대후문", stationsVersion: versionOf(routes, "jongro02") }]);
  });

  it("names nothing at the last index of a route", async () => {
    // Arrange
    const [snapshot, routes] = await Promise.all([snapshotOf(), routesOf()]);

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "seoul-01616")).toEqual([{ kind: "jongro", groupId: "jongro07", stationIndex: 21, towards: null, stationsVersion: versionOf(routes, "jongro07") }]);
  });

  it.each(["0", "", "00000", "1592", "015920"])("gives a station with the ARS number %p no stop", async (arsId) => {
    // Arrange
    const snapshot = await snapshotOf();
    const routes = await routesOf((repository) => {
      repository.routes.get("jongro07")!.stations[17]!.arsId = arsId;
    });

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(index.stopById.has("seoul-01226")).toBe(false);
    expect([...index.stopById.keys()].filter((id) => id.startsWith("seoul-") && !/^seoul-\d{5}$/.test(id))).toEqual([]);
    expect(index.stopById.has(`seoul-${arsId}`)).toBe(false);
  });

  it("indexes every pole of 02, 07 and 08 with an ARS number: 69", async () => {
    // Arrange
    const [snapshot, routes] = await Promise.all([snapshotOf(), routesOf()]);

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect([...index.stopById.keys()].filter((id) => id.startsWith("seoul-"))).toHaveLength(69);
  });

  it("maps each HSSC position with a stop to its index, and the non-stop positions to nothing", async () => {
    // Arrange
    const [snapshot, routes] = await Promise.all([snapshotOf(), routesOf()]);

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "hssc-hyehwa-exit1")).toEqual([{ kind: "hssc", groupId: "hssc", stationIndex: 6 }]);
    expect(routesAt(index, "hssc-main-gate-out")).toEqual([{ kind: "hssc", groupId: "hssc", stationIndex: 2 }]);
    expect(routesAt(index, "hssc-main-gate-in")).toEqual([{ kind: "hssc", groupId: "hssc", stationIndex: 9 }]);
    expect(index.stopById.get("hssc-hyehwa-exit1")?.localStop?.id).toBe("hssc-hyehwa-exit1");
    expect([...index.stopById.values()].flatMap((stop) => stop.routes).filter((route) => route.kind === "hssc")).toHaveLength(9);
  });

  it("maps each sequence stop to its group, service, route type and index, campus before commute", async () => {
    // Arrange
    const [snapshot, routes] = await Promise.all([snapshotOf(), routesOf()]);

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "hssc-bus-lot")).toEqual([
      { kind: "shuttle", groupId: "campus", serviceId: "campus-inja", routeType: "regular", sequenceIndex: 0, action: "board", timing: "scheduled" },
      { kind: "shuttle", groupId: "campus", serviceId: "campus-inja", routeType: "hakbu", sequenceIndex: 0, action: "board", timing: "scheduled" },
    ]);
    expect(routesAt(index, "nsc-n-center")?.map((route) => (route.kind === "shuttle" ? `${route.serviceId}:${route.routeType}:${route.action}` : route.kind))).toEqual([
      "campus-inja:regular:alight",
      "campus-inja:hakbu:alight",
      "commute-jeongja:up:alight",
      "commute-jamsil:up:alight",
      "commute-dogok:up:alight",
      "commute-gangnam-yangjae:up:alight",
      "commute-gwanggyo:up:alight",
    ]);
    expect(routesAt(index, "yangjae-exit2")).toEqual([
      { kind: "shuttle", groupId: "commute", serviceId: "commute-gangnam-yangjae", routeType: "up", sequenceIndex: 1, action: "board", timing: "scheduled" },
    ]);
  });

  it("resolves an aliased pole to its local stop, which lists the shuttles and then 07", async () => {
    // Arrange
    const snapshot = await snapshotOf((data) => {
      data.stops.find((stop) => stop.id === "hssc-bus-lot")!.arsIds = ["01618"];
    });
    const routes = await routesOf();

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(index.stopIdByArsId.get("01618")).toBe("hssc-bus-lot");
    expect(index.stopById.has("seoul-01618")).toBe(false);
    expect(index.stopById.get("hssc-bus-lot")).toMatchObject({ localStop: { id: "hssc-bus-lot" }, poles: [{ arsId: "01618", topisId: "100900221", stationName: "학생회관" }] });
    expect(routesAt(index, "hssc-bus-lot")?.map((route) => route.groupId)).toEqual(["campus", "campus", "jongro07"]);
    expect(index.unmatchedArsIds).toEqual([]);
  });

  it("keeps an unaliased pole beside a local stop as two stops", async () => {
    // Arrange
    const [snapshot, routes] = await Promise.all([snapshotOf(), routesOf()]);

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "hssc-600th")?.map((route) => route.groupId)).toEqual(["campus", "campus"]);
    expect(routesAt(index, "seoul-01616")?.map((route) => route.groupId)).toEqual(["jongro07"]);
  });

  it("serves nothing for an alias no stored station has, and names it", async () => {
    // Arrange
    const snapshot = await snapshotOf((data) => {
      data.stops.find((stop) => stop.id === "hssc-600th")!.arsIds = ["09999"];
    });
    const routes = await routesOf();

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(index.unmatchedArsIds).toEqual(["09999"]);
    expect(index.stopIdByArsId.has("09999")).toBe(false);
    expect(index.stopById.get("hssc-600th")?.poles).toEqual([]);
  });

  it("follows a pole TOPIS added and drops one it removed", async () => {
    // Arrange
    const snapshot = await snapshotOf();
    const routes = await routesOf((repository) => {
      const jongro08 = repository.routes.get("jongro08")!;
      jongro08.stations = [...jongro08.stations, { topisId: "NEW", arsId: "01999", stationName: "새 정류장", sequence: jongro08.stations.length + 1 }];
      for (const doc of repository.routes.values()) doc.stations = doc.stations.filter((station) => station.arsId !== "01543");
    });

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "seoul-01999")).toEqual([{ kind: "jongro", groupId: "jongro08", stationIndex: 30, towards: null, stationsVersion: versionOf(routes, "jongro08") }]);
    expect(index.stopById.has("seoul-01543")).toBe(false);
  });

  it("resolves a pole aliased by its TOPIS station to its local stop, whose ARS number then names that stop too", async () => {
    // Arrange
    const snapshot = await snapshotOf((data) => {
      data.stops.find((stop) => stop.id === "hssc-bus-lot")!.topisIds = ["100900221"];
    });
    const routes = await routesOf();

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(index.stopIdByArsId.get("01618")).toBe("hssc-bus-lot");
    expect(index.stopById.has("seoul-01618")).toBe(false);
    expect(index.stopById.get("hssc-bus-lot")).toMatchObject({ localStop: { id: "hssc-bus-lot" }, poles: [{ arsId: "01618", topisId: "100900221", stationName: "학생회관" }] });
    expect(routesAt(index, "hssc-bus-lot")?.map((route) => route.groupId)).toEqual(["campus", "campus", "jongro07"]);
    expect(index.unmatchedTopisIds).toEqual([]);
  });

  it("resolves a pole with no ARS number through its TOPIS alias, and gives it no ARS number", async () => {
    // Arrange
    const snapshot = await snapshotOf((data) => {
      data.stops.find((stop) => stop.id === "hssc-600th")!.topisIds = ["100000424"];
    });
    const routes = await routesOf((repository) => {
      repository.routes.get("jongro07")!.stations[2]!.arsId = "0";
    });

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "hssc-600th")?.at(-1)).toEqual({ kind: "jongro", groupId: "jongro07", stationIndex: 2, towards: "성균관대정문", stationsVersion: versionOf(routes, "jongro07") });
    expect(index.stopById.get("hssc-600th")?.poles).toEqual([{ arsId: null, topisId: "100000424", stationName: "비천당" }]);
  });

  it("lets a TOPIS alias win over another stop's ARS alias of the same pole", async () => {
    // Arrange
    const snapshot = await snapshotOf((data) => {
      data.stops.find((stop) => stop.id === "hssc-600th")!.arsIds = ["01618"];
      data.stops.find((stop) => stop.id === "hssc-bus-lot")!.topisIds = ["100900221"];
    });
    const routes = await routesOf();

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(index.stopIdByArsId.get("01618")).toBe("hssc-bus-lot");
    expect(routesAt(index, "hssc-600th")?.map((route) => route.groupId)).toEqual(["campus", "campus"]);
  });

  it("serves nothing for a TOPIS alias no stored station has, and names it", async () => {
    // Arrange
    const snapshot = await snapshotOf((data) => {
      data.stops.find((stop) => stop.id === "hssc-600th")!.topisIds = ["200000162"];
    });
    const routes = await routesOf();

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(index.unmatchedTopisIds).toEqual(["200000162"]);
    expect(index.unmatchedArsIds).toEqual([]);
    expect(index.stopById.get("hssc-600th")?.poles).toEqual([]);
  });

  it("indexes only the aliased poles of a route /bus/config does not list", async () => {
    // Arrange
    const snapshot = await snapshotOf((data) => {
      data.stops.find((stop) => stop.id === "hssc-bus-lot")!.arsIds = ["01618"];
      data.stops.find((stop) => stop.id === "hssc-600th")!.topisIds = ["100000424"];
    });
    const routes = (await routesOf()).map((route) => (route.id === "jongro07" ? { ...route, isListed: false } : route));

    // Act
    const index = toStopIndex(snapshot, routes);

    // Assert
    expect(routesAt(index, "hssc-bus-lot")?.map((route) => route.groupId)).toEqual(["campus", "campus", "jongro07"]);
    expect(routesAt(index, "hssc-600th")?.map((route) => route.groupId)).toEqual(["campus", "campus", "jongro07"]);
    expect(routesAt(index, "seoul-01592")?.map((route) => route.groupId)).toEqual(["jongro08"]);
    expect(index.stopById.has("seoul-01616")).toBe(false);
    expect(index.stopIdByArsId.has("01616")).toBe(false);
    expect([...index.stopById.values()].flatMap((stop) => stop.routes).filter((route) => route.groupId === "jongro07")).toHaveLength(2);
  });

  it("lists only the routes it is given", async () => {
    // Arrange
    const [snapshot, routes] = await Promise.all([snapshotOf(), routesOf()]);

    // Act
    const index = toStopIndex(snapshot, routes.filter((route) => route.id !== "jongro07"));

    // Assert
    expect(routesAt(index, "seoul-01592")?.map((route) => route.groupId)).toEqual(["jongro08"]);
    expect(index.stopById.has("seoul-01616")).toBe(false);
  });
});
