/**
 * SubwayStationsService, subway's door for the modules that list the served
 * stations (the transit tab): every station of the registry, in its order,
 * by slug, with its title and its lines' codes, names, badges and colors.
 */
import { SubwayStationsService } from "./subway-stations.service";

describe("SubwayStationsService.listStations", () => {
  it("lists both served stations in order, by slug, with their lines' codes and colors", () => {
    // Arrange
    const service = new SubwayStationsService();

    // Act
    const stations = service.listStations();

    // Assert
    expect(stations.map(({ id, lines }) => ({ id, lines: lines.map(({ code, color }) => ({ code, color })) }))).toEqual([
      { id: "sungkyunkwan", lines: [{ code: "1", color: "0052A4" }] },
      { id: "hyehwa", lines: [{ code: "4", color: "00A5DE" }] },
    ]);
    expect(stations[1]?.title.ko).toBe("혜화역");
  });
});
