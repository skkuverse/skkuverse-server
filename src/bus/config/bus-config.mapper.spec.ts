/**
 * The bus group mappers: a station as the app lists it (0-based index, the
 * English subtitle or the stop number, null when neither), the groups in the
 * order the app lists them, the Jongro routes in registry order, and the
 * refresh a schedule service offers when it serves live arrival estimates.
 */
import { jongroRoutes } from "../bus.config";
import { SERVICE_CONFIG } from "../bus.constants";
import { HSSC_STATIONS } from "./bus-config.constants";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import { mapStations, toBusGroups } from "./bus-config.mapper";

const NO_STOPS = { sequences: {}, stops: [] };

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

  it("falls back to the stop number, then null, for the subtitle", () => {
    // Arrange
    const station = { ...jongroRoutes[0]!.stations[0]!, stationNumber: "01881" };

    // Act & Assert
    expect(mapStations([station])[0]!.subtitle).toBe("01881");
    expect(mapStations([{ ...station, stationNumber: null }])[0]!.subtitle).toBeNull();
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
