/**
 * The directions of a realtime line, as /bus/config serves them. A Jongno route's are TOPIS's: each registry
 * station takes the `direction` its stored route path station carries at the same sequence and TOPIS id, so the label
 * flips at the station after the turnaround, as NAVER Map's tabs do; a station that cannot be joined (no stored line,
 * a line stored before directions, another station at its sequence, a line too short) has none, never a neighbour's,
 * and labels that do not form one block each serve no direction at all. Each direction's id is the TOPIS id of the
 * terminal it heads to, the next direction's first station, the line's first for the last one. The HSSC line's two are
 * the owner's split (2026-10-23): fromCampus at positions 0 to 5, toCampus at 6 to 10. Labels follow the request language, the
 * Korean terminal name kept in every one. A station's direction, as a stop page names it, is the one its config station
 * lies on, with its label; none for a station with none, a schedule group, no group, or a group another stations
 * version placed than the caller's.
 */
import { storedBusRegistryService } from "../../../__tests__/helpers/bus/bus-registry";
import { capturedRoutePathOf } from "../../../__tests__/helpers/bus/bus-route-path";
import { HSSC_POSITION_COUNT } from "../bus.constants";
import type { RegistryRoute } from "../registry/bus-registry.types";
import type { RoutePathStation } from "../route-path/bus-route-path.document";
import { toHsscDirections, toJongroDirections, toLineStationDirections, toStationDirection, toStationDirections } from "./bus-config.rules";
import type { BusGroup } from "./bus-config.wire";

let routes: RegistryRoute[] = [];

beforeAll(async () => {
  routes = await storedBusRegistryService().listRoutes();
});

const routeOf = (id: string) => routes.find((route) => route.id === id)!;
const pathStationsOf = (id: string): RoutePathStation[] => capturedRoutePathOf(id).stations;
function runsOf(ids: ReadonlyArray<string | null>): Array<[string | null, number]> {
  const runs: Array<[string | null, number]> = [];
  for (const id of ids) {
    const last = runs.at(-1);
    if (last?.[0] === id) last[1] += 1;
    else runs.push([id, 1]);
  }
  return runs;
}

describe("toJongroDirections", () => {
  it("splits 종로07 after its turnaround 방송통신대앞 (index 12) into 이화사거리 and 성균관대운동장, as NAVER Map does", () => {
    // Act
    const { directions, directionIds } = toJongroDirections(routeOf("jongro07").registryStations, pathStationsOf("jongro07"), "ko");

    // Assert
    expect(directions).toEqual([
      { id: "100900043", label: "이화사거리 방면", fromIndex: 0, toIndex: 12 },
      { id: "100900220", label: "성균관대운동장 방면", fromIndex: 13, toIndex: 21 },
    ]);
    expect(runsOf(directionIds)).toEqual([
      ["100900043", 13],
      ["100900220", 9],
    ]);
  });

  it("splits 종로02, whose terminal it lists first and last, and 종로08 the same way", () => {
    // Act
    const [route02, route08] = ["jongro02", "jongro08"].map((id) => toJongroDirections(routeOf(id).registryStations, pathStationsOf(id), "ko"));

    // Assert
    expect(route02!.directions).toEqual([
      { id: "100900116", label: "종각역YMCA 방면", fromIndex: 0, toIndex: 12 },
      { id: "100900204", label: "성균관대학교 방면", fromIndex: 13, toIndex: 26 },
    ]);
    expect(route08!.directions).toEqual([
      { id: "100900191", label: "종로5가 방면", fromIndex: 0, toIndex: 15 },
      { id: "100900040", label: "명륜3가 방면", fromIndex: 16, toIndex: 30 },
    ]);
    expect(route02!.directionIds.at(-1)).toBe("100900204");
  });

  it.each([
    ["en", ["To 이화사거리", "To 성균관대운동장"]],
    ["zh", ["이화사거리 方向", "성균관대운동장 方向"]],
  ] as const)("labels each direction in %s around the Korean terminal name", (lang, labels) => {
    // Act
    const { directions } = toJongroDirections(routeOf("jongro07").registryStations, pathStationsOf("jongro07"), lang);

    // Assert
    expect(directions.map((direction) => direction.label)).toEqual(labels);
    expect(directions.map((direction) => direction.id)).toEqual(["100900043", "100900220"]);
  });

  it("gives a station whose sequence holds another TOPIS id in the stored line no direction, and keeps the others", () => {
    // Arrange
    const pathStations = pathStationsOf("jongro07").map((station) => (station.sequence === 6 ? { ...station, topisId: "100900999" } : station));

    // Act
    const { directions, directionIds } = toJongroDirections(routeOf("jongro07").registryStations, pathStations, "ko");

    // Assert
    expect(directionIds[5]).toBeNull();
    expect(directionIds.filter((id) => id === null)).toHaveLength(1);
    expect(directions.map((direction) => [direction.fromIndex, direction.toIndex])).toEqual([
      [0, 12],
      [13, 21],
    ]);
  });

  it("gives the stations past a shorter stored line, and one whose stored station carries no direction, none", () => {
    // Arrange
    const pathStations = pathStationsOf("jongro07")
      .slice(0, 20)
      .map((station) => (station.sequence === 2 ? { ...station, direction: null } : station));

    // Act
    const { directions, directionIds } = toJongroDirections(routeOf("jongro07").registryStations, pathStations, "ko");

    // Assert
    expect(directionIds.map((id, index) => (id === null ? index : -1)).filter((index) => index >= 0)).toEqual([1, 20, 21]);
    expect(directions.map((direction) => [direction.fromIndex, direction.toIndex])).toEqual([
      [0, 12],
      [13, 19],
    ]);
  });

  it.each([
    ["no stored line", undefined],
    ["a line stored before directions", pathStationsOf("jongro07").map(({ direction: _direction, ...station }) => station)],
  ])("serves no direction and every station none with %s", (_label, pathStations) => {
    // Act
    const { directions, directionIds } = toJongroDirections(routeOf("jongro07").registryStations, pathStations, "ko");

    // Assert
    expect(directions).toEqual([]);
    expect(directionIds).toEqual(Array(22).fill(null));
  });

  it("serves no direction when a terminal's stations are not one block", () => {
    // Arrange
    const pathStations = pathStationsOf("jongro07").map((station) => (station.sequence === 20 ? { ...station, direction: "이화사거리" } : station));

    // Act
    const { directions, directionIds } = toJongroDirections(routeOf("jongro07").registryStations, pathStations, "ko");

    // Assert
    expect(directions).toEqual([]);
    expect(directionIds).toEqual(Array(22).fill(null));
  });
});

describe("toHsscDirections", () => {
  it("serves 하교 at positions 0 to 5 and 등교 at 6 to 10, the rotary passes included", () => {
    // Act
    const { directions, directionIds } = toHsscDirections("ko");

    // Assert
    expect(directions).toEqual([
      { id: "fromCampus", label: "하교", fromIndex: 0, toIndex: 5 },
      { id: "toCampus", label: "등교", fromIndex: 6, toIndex: 10 },
    ]);
    expect(directionIds).toEqual([...Array(6).fill("fromCampus"), ...Array(5).fill("toCampus")]);
  });

  it("covers every HSSC position once, in line order", () => {
    // Act
    const { directions, directionIds } = toHsscDirections("ko");

    // Assert
    expect(directionIds).toHaveLength(HSSC_POSITION_COUNT);
    expect(directions[0]!.fromIndex).toBe(0);
    expect(directions.at(-1)!.toIndex).toBe(HSSC_POSITION_COUNT - 1);
    expect(directions[1]!.fromIndex).toBe(directions[0]!.toIndex + 1);
  });

  it.each([
    ["en", ["From campus", "To campus"]],
    ["zh", ["放学", "上学"]],
  ] as const)("labels both in %s with the same ids", (lang, labels) => {
    // Act
    const { directions } = toHsscDirections(lang);

    // Assert
    expect(directions.map((direction) => [direction.id, direction.label])).toEqual([
      ["fromCampus", labels[0]],
      ["toCampus", labels[1]],
    ]);
  });
});

describe("toStationDirection", () => {
  const realtime = (directionIds: Array<string | null>, stationsVersion?: string) =>
    ({
      id: "jongro07",
      screenType: "realtime",
      screen: {
        stations: directionIds.map((directionId, index) => ({ index, directionId })),
        directions: [
          { id: "100900043", label: "이화사거리 방면", fromIndex: 0, toIndex: 1 },
          { id: "100900220", label: "성균관대운동장 방면", fromIndex: 2, toIndex: 3 },
        ],
        ...(stationsVersion !== undefined && { stationsVersion }),
      },
    }) as unknown as BusGroup;

  it("names the direction the station at the index lies on, by its id and label", () => {
    // Arrange
    const group = realtime(["100900043", "100900043", "100900220", "100900220"], "v1");

    // Act & Assert
    expect(toStationDirection(group, 1, "v1")).toEqual({ id: "100900043", label: "이화사거리 방면" });
    expect(toStationDirection(group, 2, "v1")).toEqual({ id: "100900220", label: "성균관대운동장 방면" });
  });

  it("matches a group without a stations version, the HSSC line's, to a null one", () => {
    // Act & Assert
    expect(toStationDirection(realtime(["100900043"]), 0, null)).toEqual({ id: "100900043", label: "이화사거리 방면" });
  });

  it("answers null for another stations version, a station with none, an index past the line and an unlisted id", () => {
    // Arrange
    const group = realtime(["100900043", null, "gone"], "v1");

    // Act & Assert
    expect([toStationDirection(group, 0, "v2"), toStationDirection(group, 0, null), toStationDirection(group, 1, "v1"), toStationDirection(group, 9, "v1"), toStationDirection(group, 2, "v1")]).toEqual([null, null, null, null, null]);
  });

  it("answers null for a schedule group and for no group", () => {
    // Arrange
    const schedule = { id: "campus", screenType: "schedule", screen: { services: [] } } as unknown as BusGroup;

    // Act & Assert
    expect([toStationDirection(schedule, 0, null), toStationDirection(null, 0, null)]).toEqual([null, null]);
  });
});

// WHY: a live answer heads every station's calls at once (ADR 0022, D2), so each station's direction comes by index.
describe("toStationDirections", () => {
  const realtime = (directionIds: Array<string | null>) =>
    ({
      id: "jongro07",
      screenType: "realtime",
      screen: {
        stations: directionIds.map((directionId, index) => ({ index, directionId })),
        directions: [{ id: "100900043", label: "이화사거리 방면", fromIndex: 0, toIndex: 1 }],
        stationsVersion: "v1",
      },
    }) as unknown as BusGroup;

  it("names each station's direction by its index, as toStationDirection names one, null where it has none", () => {
    // Act & Assert
    expect(toStationDirections(realtime(["100900043", null]), "v1")).toEqual([{ id: "100900043", label: "이화사거리 방면" }, null]);
  });

  it("names none for another stations version, a schedule group and no group", () => {
    // Arrange
    const schedule = { id: "campus", screenType: "schedule", screen: { services: [] } } as unknown as BusGroup;

    // Act & Assert
    expect([toStationDirections(realtime(["100900043"]), "v2"), toStationDirections(schedule, null), toStationDirections(null, null)]).toEqual([[null], [], []]);
  });
});

describe("toLineStationDirections", () => {
  it("names each station's direction by its index, null where it joins none", () => {
    // Arrange
    const directions = [{ id: "toCampus", label: "등교", fromIndex: 0, toIndex: 0 }];

    // Act & Assert
    expect(toLineStationDirections({ directions, directionIds: ["toCampus", null, "gone"] })).toEqual([{ id: "toCampus", label: "등교" }, null, null]);
  });
});
