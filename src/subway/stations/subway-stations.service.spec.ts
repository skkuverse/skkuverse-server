/**
 * SubwayStationsService, subway's door for the modules that list the served
 * stations (the transit tab): every station of SUBWAY_STATIONS, in its order,
 * with its title, line code, line label and line color.
 */
import { SubwayStationsService } from "./subway-stations.service";

describe("SubwayStationsService.listStations", () => {
  it("lists both served stations in order, with their line colors", () => {
    // Arrange
    const service = new SubwayStationsService();

    // Act
    const stations = service.listStations();

    // Assert
    expect(stations.map(({ id, lineCode, lineColor }) => ({ id, lineCode, lineColor }))).toEqual([
      { id: "KR-1-0153", lineCode: "1", lineColor: "0052A4" },
      { id: "S1-4-420", lineCode: "4", lineColor: "00A5DE" },
    ]);
    expect(stations[1]?.title.ko).toBe("혜화역");
  });
});
