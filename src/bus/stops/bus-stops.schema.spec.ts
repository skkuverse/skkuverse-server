/**
 * stopCatalogFile carries the catalog checks through a parse: the committed
 * catalog passes as it is against the served subway stations, and a broken
 * one fails with each check's own words.
 */
import { SERVICE_CONFIG } from "../bus.constants";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { stopCatalogFile } from "./bus-stops.schema";
import { etaOptIns } from "./bus-stops.rules";

const raw = require("./schedule-stops.json");
const stationIds = new Set(new SubwayStationsService().listStations().map((station) => station.id));
const schema = stopCatalogFile({ knownServiceIds: new Set(Object.keys(SERVICE_CONFIG)), optIns: etaOptIns(SERVICE_CONFIG), stationIds });

describe("stopCatalogFile", () => {
  it("passes the committed catalog through as it is", () => {
    // Act & Assert
    expect(schema.parse(raw)).toBe(raw);
  });

  it("fails a broken catalog with the check's words", () => {
    // Act
    const result = schema.safeParse([]);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.message)).toEqual(["schedule-stops.json must be { stops: [], sequences: {} }"]);
  });

  it("fails the committed catalog with jeongja-exit2 naming the station jeongja2", () => {
    // Arrange
    const broken = structuredClone(raw);
    broken.stops.find((stop: { id: string }) => stop.id === "jeongja-exit2").subwayStationId = "jeongja2";

    // Act
    const result = schema.safeParse(broken);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.message)).toEqual(['stop jeongja-exit2: subwayStationId "jeongja2" is not a served subway station']);
  });

  it("reports the station issue beside the other catalog issues, in one parse", () => {
    // Arrange
    const broken = structuredClone(raw);
    const stop = broken.stops.find((s: { id: string }) => s.id === "jeongja-exit2");
    stop.subwayStationId = "jeongja2";
    stop.name = {};

    // Act
    const result = schema.safeParse(broken);

    // Assert
    expect(result.error!.issues.map((issue) => issue.message)).toEqual([
      "stop jeongja-exit2: name has no Korean text",
      'stop jeongja-exit2: subwayStationId "jeongja2" is not a served subway station',
    ]);
  });
});
