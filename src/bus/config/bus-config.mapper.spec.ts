/**
 * The bus group mappers: a station as the app lists it (0-based index, the
 * English subtitle or the stop number, null when neither), and the groups in
 * the order the app lists them, the Jongro routes in registry order.
 */
import { jongroRoutes } from "../bus.config";
import { HSSC_STATIONS } from "./bus-config.constants";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import { mapStations, toBusGroups } from "./bus-config.mapper";

const NO_STOPS = { sequences: {}, stops: [] };

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
