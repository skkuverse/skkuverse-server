/**
 * The arrivals route's two decisions: the stored state is served while it is
 * at most 2 minutes old, and a train is so many stops away as its last
 * observed station says: 0 at the served station, the upstream station's
 * place in its direction's list (nearest first, from 1) at an upstream
 * station whatever its state there, and unknown (null) for a station off the
 * list or a train nothing has reported.
 */
import { SUBWAY_STATIONS } from "../subway.constants";
import type { SubwayStation } from "../subway.types";
import { isFreshState, toStopsAway } from "./subway-arrivals.rules";

const GENERATED_AT = new Date("2026-10-16T11:41:00Z");

describe("isFreshState", () => {
  it.each([
    ["119 s", "2026-10-16T11:42:59Z", true],
    ["120 s", "2026-10-16T11:43:00Z", true],
    ["121 s", "2026-10-16T11:43:01Z", false],
  ])("reads a state generated %s ago as fresh: %s", (_label, nowIso, fresh) => {
    // Act
    const isFresh = isFreshState(GENERATED_AT, new Date(nowIso));

    // Assert
    expect(isFresh).toBe(fresh);
  });
});

describe("toStopsAway", () => {
  const SUNGKYUNKWAN = SUBWAY_STATIONS.find((s) => s.id === "KR-1-0153") as SubwayStation;
  const DOWN = SUNGKYUNKWAN.directions.down;

  it.each([
    ["approaching the served station", { stationId: "KR-1-0153", state: "approaching" }, 0],
    ["standing at the served station", { stationId: "KR-1-0153", state: "arrived" }, 0],
    ["arrived at the nearest upstream station", { stationId: "KR-1-P152", state: "arrived" }, 1],
    ["departed the nearest upstream station", { stationId: "KR-1-P152", state: "departed" }, 1],
    ["approaching the second upstream station", { stationId: "KR-1-P151", state: "approaching" }, 2],
    ["at the third upstream station", { stationId: "KR-1-P150", state: "arrived" }, 3],
    ["at a station past the upstream list", { stationId: "KR-1-P157", state: "arrived" }, null],
    ["at the station after the served one", { stationId: "KR-1-P154", state: "arrived" }, null],
    ["nothing has reported", null, null],
  ] as const)("reads a 성균관대 down train %s as %p stops away", (_label, position, stopsAway) => {
    // Act
    const stops = toStopsAway(DOWN, "KR-1-0153", position);

    // Assert
    expect(stops).toBe(stopsAway);
  });
});
