/**
 * The push check a schema cannot hold: the stored coords name exactly the
 * stations the checked-out code serves. A station the code serves without
 * coords, and coords for a station it does not serve, are each named at
 * `stations.<slug>`, missing ones in the code's order first.
 */
import { stationCoordsFixture } from "../../../__tests__/helpers/subway/station-coords";
import { SUBWAY_STATIONS } from "../subway.constants";
import { toStationCoordsIssues } from "./subway-station-coords.rules";

const CODE_STATION_IDS = SUBWAY_STATIONS.map((station) => station.id);

describe("toStationCoordsIssues", () => {
  it("finds none for revision 1 against the code's eight stations", () => {
    // Act & Assert
    expect(toStationCoordsIssues(stationCoordsFixture(), CODE_STATION_IDS)).toEqual([]);
  });

  it("Station missing: names dogok when the coords lack it", () => {
    // Arrange
    const coords = stationCoordsFixture();
    delete coords.stations.dogok;

    // Act & Assert
    expect(toStationCoordsIssues(coords, CODE_STATION_IDS)).toEqual([
      { path: ["stations", "dogok"], message: 'missing: the checked-out code serves "dogok", so it needs coords' },
    ]);
  });

  it("names a station the code does not serve", () => {
    // Arrange
    const coords = stationCoordsFixture();
    coords.stations.suwon = { lat: 37.266, lng: 127.0 };

    // Act & Assert
    expect(toStationCoordsIssues(coords, CODE_STATION_IDS)).toEqual([
      { path: ["stations", "suwon"], message: '"suwon" is not a station the checked-out code serves' },
    ]);
  });

  it("names every missing station in the code's order, then every unknown one", () => {
    // Arrange
    const { stations } = stationCoordsFixture();
    const coords = { stations: { suwon: stations.hyehwa!, gangnam: stations.gangnam!, hyehwa: stations.hyehwa! } };

    // Act
    const issues = toStationCoordsIssues(coords, ["sungkyunkwan", "hyehwa", "gangnam", "yangjae"]);

    // Assert
    expect(issues.map((issue) => issue.path.join("."))).toEqual(["stations.sungkyunkwan", "stations.yangjae", "stations.suwon"]);
  });

  it("does not take an Object.prototype name for a stored station", () => {
    // Act & Assert
    expect(toStationCoordsIssues({ stations: {} }, ["constructor"])).toEqual([
      { path: ["stations", "constructor"], message: 'missing: the checked-out code serves "constructor", so it needs coords' },
    ]);
  });
});
