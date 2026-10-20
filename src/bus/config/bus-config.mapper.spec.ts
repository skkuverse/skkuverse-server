/**
 * The bus group mappers: a station as the app lists it (0-based index, the
 * English subtitle, null without one, never the stop number), the groups in the
 * order the app lists them, the Jongro routes in registry order, and the
 * refresh a schedule service offers when it serves live arrival estimates. A
 * Jongro group joins its route's stored attributes (move-reference-datasets
 * D10): the card's theme color and icon type, the refresh interval, and each
 * station's transfer lines by its ARS number.
 */
import { storedBusRegistryService } from "../../../__tests__/helpers/bus/bus-registry";
import { routeAttributesFixture } from "../../../__tests__/helpers/bus/route-attributes";
import { JONGRO_ROUTES } from "../bus.constants";
import { SERVICE_CONFIG } from "../bus.constants";
import type { JongroRouteAttributes } from "../bus.types";
import type { AttributedJongroRoute } from "./bus-config.types";
import { HSSC_STATIONS } from "./bus-config.constants";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import { mapStations, toBusGroupIds, toBusGroups } from "./bus-config.mapper";

const NO_STOPS = { sequences: {}, stops: [] };

// WHY: the Jongro routes as the registry derives them from the routes stored on 2026-10-17, with revision 1's attributes.
let jongroRoutes: AttributedJongroRoute[] = [];

beforeAll(async () => {
  const { routes } = routeAttributesFixture();
  jongroRoutes = (await storedBusRegistryService().listRoutes()).map((route) => ({ route, attributes: routes[route.id]! }));
});

const jongroGroupOf = (routes: AttributedJongroRoute[], id: string) =>
  toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, jongroRoutes: routes, webviewOrigin: WEBVIEW_ORIGIN }).find((g) => g.id === id)!;

type JongroScreen = { refreshInterval: number; stations: Array<{ name: string; stationNumber: string | null; transferLines: Array<{ line: string; color: string }> }> };

type ScheduleService = { serviceId: string; refresh?: unknown };

function scheduleServicesById(): Map<string, ScheduleService> {
  const groups = toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });
  const services = groups.flatMap((g) => ("services" in g.screen ? (g.screen.services as ScheduleService[]) : []));
  return new Map(services.map((s) => [s.serviceId, s]));
}

describe("mapStations", () => {
  it("lists an HSSC station with its English subtitle", () => {
    // Act
    const [first] = mapStations(HSSC_STATIONS);

    // Assert
    expect(first).toEqual({
      index: 0,
      name: "농구장",
      subtitle: "Basketball Court (Shuttle Bus Stop)",
      stationNumber: null,
      isFirstStation: true,
      isLastStation: false,
      isRotationStation: false,
      transferLines: [],
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
    const groups = toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });

    // Assert
    expect(groups.map((g) => g.id)).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"]);
  });

  it("leaves out `stops` when a schedule group references none", () => {
    // Act
    const groups = toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });

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
  it("appends the route's stations version to its realtime screen, last", () => {
    // Act
    const groups = toBusGroups({ lang: "ko", stops: { campus: NO_STOPS, commute: NO_STOPS }, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });

    // Assert
    const screen = groups.find((g) => g.id === "jongro07")!.screen as Record<string, unknown>;
    expect(screen.stationsVersion).toBe(jongroRoutes[1]!.route.stationsVersion);
    expect(Object.keys(screen).at(-1)).toBe("stationsVersion");
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
