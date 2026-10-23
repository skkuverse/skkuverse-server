/**
 * The bus group mappers: a station as the app lists it (0-based index, the
 * English subtitle, null without one, never the stop number), the groups in the
 * order the app lists them, the Jongro routes in registry order, and the
 * refresh a schedule service offers when it serves live arrival estimates. A
 * Jongro group joins its route's stored attributes (ADR 0013, D2):
 * the card's theme color and icon type, the refresh interval, and each
 * station's transfer lines by its ARS number. The HSSC line is the stored
 * bus-stops revision 1's; ported (old → new): "lists an
 * HSSC station with its English subtitle" maps that line instead of
 * HSSC_STATIONS, with the same expected station.
 *
 * Each station carries its stop as its last field, `stopId`:
 * an HSSC position its stored stop, a Jongno station the stop its pole
 * resolves to (the local stop aliasing it, else `seoul-<arsId>`), and a
 * station with none no key. The two HSSC stations pinned before stop ids
 * gained exactly their stop ids, on purpose, then `isPassThrough` (false at
 * both, after `isRotationStation`) when the field shipped, and then
 * `isAlightOnly` (false at both, after `isPassThrough`) when that one did; the
 * pass-through order pin moved one field for it.
 *
 * `isAlightOnly` is the stored HSSC position's flag (drop-off only), false where
 * the data leaves it out and on every Jongno station.
 */
import { storedBusRegistryService } from "../../../__tests__/helpers/bus/bus-registry";
import { busStopsFixture } from "../../../__tests__/helpers/bus/bus-stops";
import { routeAttributesFixture } from "../../../__tests__/helpers/bus/route-attributes";
import { JONGRO_ROUTES } from "../bus.constants";
import { SERVICE_CONFIG } from "../bus.constants";
import type { JongroRouteAttributes } from "../bus.types";
import type { BusStopsData } from "../stops/bus-stops.document";
import type { AttributedJongroRoute } from "./bus-config.types";
import { HSSC_STOP_IDS } from "../../../__tests__/helpers/bus/station-stop-ids";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import { mapStations, toBusGroupIds, toBusGroups } from "./bus-config.mapper";

const NO_STOPS = { sequences: {}, stops: [] };
const NO_ALIASES = new Map<string, string>();

// WHY: the HSSC line of the stored bus-stops revision 1, which the HSSC group serves.
const HSSC_LINE = (busStopsFixture() as unknown as BusStopsData).hssc.stations;

// WHY: the Jongro routes as the registry derives them from the routes stored on 2026-10-17, with revision 1's attributes.
let jongroRoutes: AttributedJongroRoute[] = [];

beforeAll(async () => {
  const { routes } = routeAttributesFixture();
  jongroRoutes = (await storedBusRegistryService().listRoutes()).map((route) => ({ route, attributes: routes[route.id]! }));
});

const jongroGroupOf = (routes: AttributedJongroRoute[], id: string) =>
  toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, hsscStations: HSSC_LINE, stopIdByArsId: NO_ALIASES, jongroRoutes: routes, webviewOrigin: WEBVIEW_ORIGIN }).find((g) => g.id === id)!;

type JongroScreen = { refreshInterval: number; stations: Array<{ name: string; stationNumber: string | null; transferLines: Array<{ line: string; color: string }> }> };

type ScheduleService = { serviceId: string; refresh?: unknown };

function scheduleServicesById(): Map<string, ScheduleService> {
  const groups = toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, hsscStations: HSSC_LINE, stopIdByArsId: NO_ALIASES, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });
  const services = groups.flatMap((g) => ("services" in g.screen ? (g.screen.services as ScheduleService[]) : []));
  return new Map(services.map((s) => [s.serviceId, s]));
}

describe("mapStations", () => {
  it("lists the stored HSSC line's 혜화역 1번출구 position with its subway line, no stop number and its stop id last", () => {
    // Act
    const mapped = mapStations(HSSC_LINE);

    // Assert
    expect(mapped).toHaveLength(11);
    expect(mapped[6]).toEqual({
      index: 6,
      name: "혜화역 1번출구",
      subtitle: "Hyehwa Station (Shuttle Bus Stop)",
      stationNumber: null,
      isFirstStation: false,
      isLastStation: false,
      isRotationStation: false,
      isPassThrough: false,
      isAlightOnly: false,
      transferLines: [{ line: "4", color: "00A5DE" }],
      stopId: "hssc-hyehwa-exit1",
    });
  });

  it("lists an HSSC station with its English subtitle", () => {
    // Act
    const [first] = mapStations(HSSC_LINE);

    // Assert
    expect(first).toEqual({
      index: 0,
      name: "농구장",
      subtitle: "Basketball Court (Shuttle Bus Stop)",
      stationNumber: null,
      isFirstStation: true,
      isLastStation: false,
      isRotationStation: false,
      isPassThrough: false,
      isAlightOnly: false,
      transferLines: [],
      stopId: "hssc-basketball-court",
    });
  });

  // WHY: the owner dropped the stop-number fallback (2026-10-18); the stop number stays in its own field.
  it("leaves a station without its own subtitle at null and keeps its stop number apart", () => {
    // Arrange
    const station = { ...jongroRoutes[0]!.route.stations[0]!, stationNumber: "01881", transferLines: [] };

    // Act
    const [mapped] = mapStations([station]);

    // Assert
    expect(mapped).toMatchObject({ subtitle: null, stationNumber: "01881" });
    expect(mapStations([{ ...station, stationNumber: null }])[0]).toMatchObject({ subtitle: null, stationNumber: null });
  });
  it("gives each HSSC position its stored stop id as its last field, and the two non-stop positions no key", () => {
    // Act
    const mapped = mapStations(HSSC_LINE);

    // Assert
    expect(mapped.map((station) => station.stopId ?? null)).toEqual(HSSC_STOP_IDS);
    for (const index of [5, 7]) expect(mapped[index]).not.toHaveProperty("stopId");
    for (const station of mapped.filter((candidate) => "stopId" in candidate)) expect(Object.keys(station).at(-1)).toBe("stopId");
  });
});

describe("toBusGroupIds", () => {
  it("lists the fixed groups, then every configured Jongro route, without their stations", () => {
    // Act & Assert
    expect(toBusGroupIds(JONGRO_ROUTES)).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"]);
  });
});

describe("toBusGroups", () => {
  it("orders hssc, campus, fasttrack, commute, then the Jongro routes", () => {
    // Act
    const groups = toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, hsscStations: HSSC_LINE, stopIdByArsId: NO_ALIASES, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });

    // Assert
    expect(groups.map((g) => g.id)).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"]);
  });

  it("leaves out `stops` when a schedule group references none", () => {
    // Act
    const groups = toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, hsscStations: HSSC_LINE, stopIdByArsId: NO_ALIASES, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });

    // Assert
    expect(groups[1]!.screen).not.toHaveProperty("stops");
  });
});

describe("toBusGroups refresh", () => {
  it("offers a traffic refresh every 60 s on each campus and commute service", () => {
    // Act
    const services = scheduleServicesById();

    // Assert
    const withRefresh = [...services.values()].filter((s) => s.refresh).map((s) => s.serviceId);
    expect(withRefresh).toEqual([
      "campus-inja",
      "campus-jain",
      "commute-jeongja",
      "commute-jamsil",
      "commute-dogok",
      "commute-gangnam-yangjae",
      "commute-gwanggyo",
    ]);
    for (const serviceId of withRefresh) expect(services.get(serviceId)!.refresh).toEqual({ targets: ["traffic"], intervalSec: 60 });
  });

  it("leaves out `refresh` on the fasttrack service, which serves no estimates", () => {
    // Act
    const fasttrack = scheduleServicesById().get("fasttrack-inja")!;

    // Assert
    expect(fasttrack).not.toHaveProperty("refresh");
  });

  it("leaves out `refresh` once a service stops opting in to estimates", () => {
    // Arrange
    const entry = SERVICE_CONFIG["campus-jain"]!;
    const eta = entry.eta;
    delete entry.eta;

    try {
      // Act
      const services = scheduleServicesById();

      // Assert
      expect(services.get("campus-jain")).not.toHaveProperty("refresh");
      expect(services.get("campus-inja")).toHaveProperty("refresh");
    } finally {
      entry.eta = eta;
    }
  });
});

describe("toBusGroups for a Jongro route", () => {
  // WHY: the live route's fields follow it (ADR 0019), a deliberate change of this pin.
  it("appends the route's stations version to its realtime screen, before the live route's fields", () => {
    // Act
    const groups = toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, hsscStations: HSSC_LINE, stopIdByArsId: NO_ALIASES, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });

    // Assert
    const screen = groups.find((g) => g.id === "jongro07")!.screen as Record<string, unknown>;
    expect(screen.stationsVersion).toBe(jongroRoutes[1]!.route.stationsVersion);
    expect(Object.keys(screen).slice(-4)).toEqual(["stationsVersion", "liveEndpoint", "isLoop", "capabilities"]);
    expect(groups.find((g) => g.id === "hssc")!.screen).not.toHaveProperty("stationsVersion");
  });

  it("takes the card's theme color and icon type and the screen's refresh interval from the route's attributes", () => {
    // Arrange
    const attributes: JongroRouteAttributes = { ...jongroRoutes[1]!.attributes, themeColor: "1E88E5", iconType: "town", refreshInterval: 30 };

    // Act
    const group = jongroGroupOf([{ ...jongroRoutes[1]!, attributes }], "jongro07");

    // Assert
    expect(group.card).toMatchObject({ themeColor: "1E88E5", iconType: "town" });
    expect((group.screen as unknown as JongroScreen).refreshInterval).toBe(30);
  });

  it("gives a station the transfer lines of its ARS number, wherever it sits, and none to a station without an entry", () => {
    // Arrange
    const { route } = jongroRoutes[1]!;
    const moved = { ...route, stations: [route.stations[1]!, { ...route.stations[0]!, stationNumber: "01589" }] };
    const attributes: JongroRouteAttributes = { ...jongroRoutes[1]!.attributes, transferLinesByArsId: { "01589": [{ line: "1", color: "0052A4" }] } };

    // Act
    const group = jongroGroupOf([{ route: moved, attributes }], "jongro07");

    // Assert
    expect((group.screen as unknown as JongroScreen).stations.map((s) => s.transferLines)).toEqual([[], [{ line: "1", color: "0052A4" }]]);
  });

  it("gives no transfer lines to a station whose ARS number names an Object.prototype member", () => {
    // Arrange
    const { route, attributes } = jongroRoutes[1]!;
    const odd = { ...route, stations: [{ ...route.stations[0]!, stationNumber: "constructor" }] };

    // Act
    const group = jongroGroupOf([{ route: odd, attributes }], "jongro07");

    // Assert
    expect((group.screen as unknown as JongroScreen).stations[0]!.transferLines).toEqual([]);
  });

  // Ported from BusRegistryService.routeOf's pins of the 2026-09 review, now joined here from the stored attributes.
  it("carries the transfer badges of the 2026-09 review on the stations they belong to", () => {
    // Arrange
    const screenOf = (id: string) => jongroGroupOf(jongroRoutes, id).screen as unknown as JongroScreen;
    const linesOf = (id: string, name: string, nth = 0) => screenOf(id).stations.filter((s) => s.name === name)[nth]!.transferLines.map((t) => t.line);

    // Act
    const r02 = screenOf("jongro02");
    const r08 = screenOf("jongro08");

    // Assert
    expect(r02.stations[11]!.transferLines).toEqual([
      { line: "1", color: "0052A4" },
      { line: "3", color: "EF7C1C" },
      { line: "5", color: "996CAC" },
    ]);
    expect(linesOf("jongro02", "조계사")).toEqual(["1"]);
    expect(linesOf("jongro02", "가회동주민센터", 1)).toEqual(["3"]);
    expect(linesOf("jongro08", "효제초교.연동교회.김마리아활동터")).toEqual(["1"]);
    expect(linesOf("jongro07", "성대입구")).toEqual(["4"]);
    expect(r08.stations[16]!.name).toBe("종로5가역.광장시장");
    expect(r08.stations[16]!.transferLines).toEqual([{ line: "1", color: "0052A4" }]);
    expect(r08.stations[9]!.transferLines).toEqual([{ line: "4", color: "00A5DE" }]);
  });
});

describe("toBusGroups stop ids on a Jongro route's stations", () => {
  type Station = { stationNumber: string | null; transferLines: unknown[]; stopId?: string };
  const stationsOf = (routes: AttributedJongroRoute[], id: string, stopIdByArsId: ReadonlyMap<string, string> = NO_ALIASES) =>
    (toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, hsscStations: HSSC_LINE, stopIdByArsId, jongroRoutes: routes, webviewOrigin: WEBVIEW_ORIGIN })
      .find((g) => g.id === id)!.screen as unknown as { stations: Station[] }).stations;

  it("Jongno station: gives 종로07's station 01592 the stop id seoul-01592 after its transfer lines", () => {
    // Act
    const station = stationsOf(jongroRoutes, "jongro07").find((candidate) => candidate.stationNumber === "01592")!;

    // Assert
    expect(station.stopId).toBe("seoul-01592");
    expect(Object.keys(station).slice(-2)).toEqual(["transferLines", "stopId"]);
  });

  it("gives every stored station of each route `seoul-<arsId>`, the terminal 종로02 lists twice at both its indexes", () => {
    // Act
    const byRoute = ["jongro02", "jongro07", "jongro08"].map((id) => stationsOf(jongroRoutes, id));

    // Assert
    for (const stations of byRoute) expect(stations.map((s) => s.stopId)).toEqual(stations.map((s) => `seoul-${s.stationNumber}`));
    expect([byRoute[0]![0]!.stopId, byRoute[0]!.at(-1)!.stopId]).toEqual(["seoul-01881", "seoul-01881"]);
  });

  it("gives an aliased pole its local stop's id, and the other poles their own", () => {
    // Arrange
    const aliases = new Map([["01618", "hssc-bus-lot"]]);

    // Act
    const stations = stationsOf(jongroRoutes, "jongro07", aliases);

    // Assert
    expect(stations.find((s) => s.stationNumber === "01618")!.stopId).toBe("hssc-bus-lot");
    expect(stations.find((s) => s.stationNumber === "01616")!.stopId).toBe("seoul-01616");
  });

  it.each(["0", ""])("gives a virtual stop (ARS number %j) no stopId key", (arsId) => {
    // Arrange
    const { route, attributes } = jongroRoutes[1]!;
    const virtual = { ...route, stations: [{ ...route.stations[0]!, stationNumber: arsId }, route.stations[1]!] };

    // Act
    const stations = stationsOf([{ route: virtual, attributes }], "jongro07");

    // Assert
    expect(stations[0]).not.toHaveProperty("stopId");
    expect(stations[1]!.stopId).toBe(`seoul-${route.stations[1]!.stationNumber}`);
  });
});

// WHY: the app labels a pass-through row as non-stop instead of showing an arrival, and cannot tell one from `stopId` alone,
// since a Jongno virtual stop has none either.
describe("toBusGroups pass-through stations", () => {
  type Station = Record<string, unknown> & { isPassThrough?: unknown; stationNumber: string | null };
  const stationsOf = (routes: AttributedJongroRoute[], id: string) =>
    (toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, hsscStations: HSSC_LINE, stopIdByArsId: NO_ALIASES, jongroRoutes: routes, webviewOrigin: WEBVIEW_ORIGIN })
      .find((g) => g.id === id)!.screen as unknown as { stations: Station[] }).stations;

  it("marks the two non-stop 혜화동로터리 HSSC positions (indexes 5 and 7) as pass-through, and every other HSSC position not", () => {
    // Act
    const stations = stationsOf(jongroRoutes, "hssc");

    // Assert
    expect(stations.map((station) => station.isPassThrough)).toEqual([false, false, false, false, false, true, false, true, false, false, false]);
  });

  it("marks no Jongno station as pass-through, a virtual stop without a stop id included", () => {
    // Arrange
    const { route, attributes } = jongroRoutes[1]!;
    const virtual = { ...route, stations: [{ ...route.stations[0]!, stationNumber: "0" }, ...route.stations.slice(1)] };

    // Act
    const byRoute = [...["jongro02", "jongro07", "jongro08"].map((id) => stationsOf(jongroRoutes, id)), stationsOf([{ route: virtual, attributes }], "jongro07")];

    // Assert
    expect(byRoute.at(-1)![0]).not.toHaveProperty("stopId");
    for (const stations of byRoute) expect(stations.map((station) => station.isPassThrough)).toEqual(stations.map(() => false));
  });

  it("serves isPassThrough after isRotationStation, so stopId stays each station's last field", () => {
    // Act
    const [rotary, stop] = [stationsOf(jongroRoutes, "hssc")[5]!, stationsOf(jongroRoutes, "jongro07")[0]!];

    // Assert
    expect(Object.keys(rotary).slice(-4)).toEqual(["isRotationStation", "isPassThrough", "isAlightOnly", "transferLines"]);
    expect(Object.keys(stop).slice(-5)).toEqual(["isRotationStation", "isPassThrough", "isAlightOnly", "transferLines", "stopId"]);
  });
});

// WHY: riders cannot board at the HSSC's two drop-off-only stops, and only a name marker said so (owner, 2026-10-23).
describe("toBusGroups drop-off-only stations", () => {
  type Station = Record<string, unknown> & { isAlightOnly?: unknown };
  const stationsOf = (hsscStations: BusStopsData["hssc"]["stations"], id: string, routes = jongroRoutes) =>
    (toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, hsscStations, stopIdByArsId: NO_ALIASES, jongroRoutes: routes, webviewOrigin: WEBVIEW_ORIGIN })
      .find((g) => g.id === id)!.screen as unknown as { stations: Station[] }).stations;
  const flaggedLine = (flags: Record<number, boolean>) => HSSC_LINE.map((station, index) => (index in flags ? { ...station, isAlightOnly: flags[index]! } : station));

  it("serves every HSSC position false when the stored line leaves the flag out, as revisions 1 and 2 do", () => {
    // Act
    const stations = stationsOf(HSSC_LINE, "hssc");

    // Assert
    expect(stations.map((station) => station.isAlightOnly)).toEqual(HSSC_LINE.map(() => false));
  });

  it("serves the stored flag: 올림픽기념국민생활관 and 혜화동우체국 (indexes 3 and 4) true, a stored false false", () => {
    // Act
    const stations = stationsOf(flaggedLine({ 3: true, 4: true, 6: false }), "hssc");

    // Assert
    expect(stations.map((station) => station.isAlightOnly)).toEqual([false, false, false, true, true, false, false, false, false, false, false]);
  });

  it("serves every Jongno station false", () => {
    // Act
    const byRoute = ["jongro02", "jongro07", "jongro08"].map((id) => stationsOf(flaggedLine({ 3: true }), id));

    // Assert
    for (const stations of byRoute) expect(stations.map((station) => station.isAlightOnly)).toEqual(stations.map(() => false));
  });

  it("serves isAlightOnly right after isPassThrough, so stopId stays each station's last field", () => {
    // Act
    const [olympicHall, stop] = [stationsOf(flaggedLine({ 3: true }), "hssc")[3]!, stationsOf(HSSC_LINE, "jongro07")[0]!];

    // Assert
    expect(Object.keys(olympicHall).slice(-4)).toEqual(["isPassThrough", "isAlightOnly", "transferLines", "stopId"]);
    expect(Object.keys(stop).slice(-4)).toEqual(["isPassThrough", "isAlightOnly", "transferLines", "stopId"]);
  });
});
