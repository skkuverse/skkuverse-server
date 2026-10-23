/**
 * The route path mappers: TOPIS points and
 * stations into a line in `no` order as [lng, lat] and stations in `seq`
 * order with their turnaround flag and direction (null where TOPIS sent
 * none); the stored document with its
 * version; and the read shape the map draws, by route id and code.
 */
import type { RoutePathStation } from "./bus-route-path.document";
import { toFetchedRoutePath, toRoutePath, toRoutePathDocument } from "./bus-route-path.mapper";
import { toPathVersion } from "./bus-route-path.rules";
import type { TopisRouteStation } from "./bus-route-path.schema";

const topisStation = (seq: number, transYn: "Y" | "N" = "N", direction: string | null = null): TopisRouteStation => ({
  station: `10090022${seq}`,
  arsId: `0161${seq}`,
  stationNm: `stop ${seq}`,
  seq,
  gpsX: Number(`126.99${seq}`),
  gpsY: 37.58,
  transYn,
  direction,
});
const station = (sequence: number): RoutePathStation => ({ topisId: `t${sequence}`, arsId: `a${sequence}`, stationName: `s${sequence}`, sequence, lng: 127, lat: 37.5, isTurnaround: false });

describe("toFetchedRoutePath", () => {
  it("orders the points by `no` into [lng, lat] and the stations by `seq`, with transYn as the turnaround", () => {
    // Arrange
    const points = [
      { no: 2, gpsX: 126.992165, gpsY: 37.588136 },
      { no: 10, gpsX: 126.993, gpsY: 37.589 },
      { no: 1, gpsX: 126.992154, gpsY: 37.588157 },
    ];

    // Act
    const fetched = toFetchedRoutePath(points, [topisStation(2, "Y"), topisStation(1)]);

    // Assert
    expect(fetched.path).toEqual([
      [126.992154, 37.588157],
      [126.992165, 37.588136],
      [126.993, 37.589],
    ]);
    expect(fetched.stations).toEqual([
      { topisId: "100900221", arsId: "01611", stationName: "stop 1", sequence: 1, lng: 126.991, lat: 37.58, isTurnaround: false, direction: null },
      { topisId: "100900222", arsId: "01612", stationName: "stop 2", sequence: 2, lng: 126.992, lat: 37.58, isTurnaround: true, direction: null },
    ]);
  });

  it("keeps each station's direction, the turnaround's outbound one included, and null where TOPIS sent none", () => {
    // Act
    const { stations } = toFetchedRoutePath([], [topisStation(3, "N", "성균관대운동장"), topisStation(2, "Y", "이화사거리"), topisStation(1, "N", null)]);

    // Assert
    expect(stations.map((each) => [each.sequence, each.direction])).toEqual([
      [1, null],
      [2, "이화사거리"],
      [3, "성균관대운동장"],
    ]);
  });
});

describe("toRoutePathDocument", () => {
  it("stores the route's TOPIS id, the content, its version and when it was written", () => {
    // Arrange
    const fetched = { path: [[127, 37.5]] as [number, number][], stations: [station(1)] };
    const syncedAt = new Date("2026-10-18T03:00:00Z");

    // Act
    const doc = toRoutePathDocument({ id: "jongro07", busRouteId: "100900004" }, fetched, syncedAt);

    // Assert
    expect(doc).toEqual({ _id: "jongro07", busRouteId: "100900004", path: fetched.path, stations: fetched.stations, pathVersion: toPathVersion(fetched), syncedAt });
  });
});

describe("toRoutePath", () => {
  it("names the line by its route id and code", () => {
    // Arrange
    const content = { path: [[127, 37.5]] as [number, number][], stations: [station(1)] };

    // Act & Assert
    expect(toRoutePath({ id: "jongro07", code: "07" }, content)).toEqual({ routeId: "jongro07", code: "07", ...content });
  });
});
