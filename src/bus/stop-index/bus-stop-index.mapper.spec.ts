/**
 * Where a stop with no stored coordinates is drawn: the stored route line's coordinates of the first of its poles that a line lists, matched
 * by TOPIS id, or none.
 */
import { capturedRoutePathOf } from "../../../__tests__/helpers/bus/bus-route-path";
import type { RoutePath } from "../route-path/bus-route-path.types";
import { toPoleCoords } from "./bus-stop-index.mapper";

const routePath = (routeId: string, code: string): RoutePath => ({ routeId, code, ...capturedRoutePathOf(routeId) });
const ROUTE_PATHS = [routePath("jongro02", "02"), routePath("jongro07", "07"), routePath("jongro08", "08")];

describe("toPoleCoords", () => {
  it("answers the route line's coordinates of the pole's TOPIS id", () => {
    // Act & Assert
    expect(toPoleCoords([{ arsId: "01592", topisId: "100900075", stationName: "혜화역1번출구" }], ROUTE_PATHS)).toEqual({ lat: 37.5834729904, lng: 127.0017632862 });
  });

  it("answers the first pole a line lists", () => {
    // Arrange
    const poles = [
      { arsId: "09999", topisId: "UNLISTED", stationName: "없는 정류장" },
      { arsId: "01618", topisId: "100900221", stationName: "학생회관" },
    ];

    // Act & Assert
    expect(toPoleCoords(poles, ROUTE_PATHS)).toEqual({ lat: 37.5874203934, lng: 126.9936746328 });
  });

  it("answers null with no pole, or no line listing one", () => {
    // Act & Assert
    expect(toPoleCoords([], ROUTE_PATHS)).toBeNull();
    expect(toPoleCoords([{ arsId: "01592", topisId: "100900075", stationName: "혜화역1번출구" }], [])).toBeNull();
  });
});
