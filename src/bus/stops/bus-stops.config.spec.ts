/**
 * loadStopCatalog is the boot check of schedule-stops.json: it returns the
 * frozen catalog when every stop's subway station is served, and throws, so
 * the boot stops, with an issue naming the stop and the station it names
 * when the subway registry does not serve that station.
 */
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { loadStopCatalog } from "./bus-stops.config";

const raw = require("./schedule-stops.json");
const stationIds = new Set(new SubwayStationsService().listStations().map((station) => station.id));

describe("loadStopCatalog", () => {
  it("returns the committed catalog, frozen, against the served stations", () => {
    // Act
    const catalog = loadStopCatalog(structuredClone(raw), stationIds);

    // Assert
    expect(catalog.stops.map((stop) => stop.id)).toEqual(raw.stops.map((stop: { id: string }) => stop.id));
    expect(Object.isFrozen(catalog.stops[0])).toBe(true);
  });

  it("throws on a stop naming a station the registry does not serve, naming the stop and the value", () => {
    // Arrange
    const broken = structuredClone(raw);
    broken.stops.find((stop: { id: string }) => stop.id === "jeongja-exit2").subwayStationId = "jeongja2";

    // Act & Assert
    expect(() => loadStopCatalog(broken, stationIds)).toThrow('stop jeongja-exit2: subwayStationId "jeongja2" is not a served subway station');
  });
});
