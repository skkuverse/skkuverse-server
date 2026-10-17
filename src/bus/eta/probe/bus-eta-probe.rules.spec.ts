/**
 * The probe's rules: which bus positions lie on the corridor and in which direction, how a bus pairs with its own
 * position about ten minutes earlier into a span, and how spans become a corridor leg time.
 */
import type { LaneCorridor, ProbeRoute } from "../lane/bus-eta-lane.types";
import { toCorridorFix, toLegTime, toSpans } from "./bus-eta-probe.rules";
import type { CorridorFix, LaneSpan } from "./bus-eta-probe.types";

// Three vertices 0.01° of latitude apart: about 1,111.95 m each on a 6,371 km sphere.
const STEP_M = (6_371_000 * 0.01 * Math.PI) / 180;

const CORRIDOR: LaneCorridor = {
  centerline: [
    { lat: 37.5, lng: 127.02 },
    { lat: 37.49, lng: 127.02 },
    { lat: 37.48, lng: 127.02 },
  ],
  boundaries: [
    { name: "north", alongM: 0 },
    { name: "middle", alongM: 1000 },
    { name: "south", alongM: Math.round(2 * STEP_M) },
  ],
};

// One meter east at 37.49°N, in degrees of longitude.
const EAST_M = 1 / (STEP_M * 100 * Math.cos((37.49 * Math.PI) / 180));
const ROUTE_8800: ProbeRoute = { routeId: "200000205", name: "8800", sectOrds: { southbound: { from: 45, to: 56 }, northbound: { from: 15, to: 27 } } };
const SEEN_AT = new Date("2026-10-16T11:35:00.000Z");

describe("toCorridorFix", () => {
  const corridor = CORRIDOR;
  const position = (eastM: number, sectOrd: number) => ({ vehId: "v1", lat: 37.49, lng: 127.02 + eastM * EAST_M, sectOrd, dataTm: SEEN_AT });

  // The limit is 60 m; a point placed exactly 60 m east lands a float's width to either side, so the rows straddle it.
  it.each([
    [59.5, true],
    [60.5, false],
    [100, false],
  ])("keeps a bus %d m off the centerline on the corridor: %s (a city road 100 m away is off it)", (eastM, onCorridor) => {
    // Act
    const fix = toCorridorFix(corridor, ROUTE_8800, position(eastM, 50));

    // Assert
    expect(fix !== null).toBe(onCorridor);
  });

  it.each([
    [45, "southbound"],
    [56, "southbound"],
    [15, "northbound"],
    [27, "northbound"],
  ])("takes the direction from the section range: section %i is %s", (sectOrd, direction) => {
    // Act
    const fix = toCorridorFix(corridor, ROUTE_8800, position(0, sectOrd));

    // Assert
    expect(fix).toMatchObject({ vehId: "v1", direction, sectOrd, dataTm: SEEN_AT });
    expect(fix!.alongM).toBeCloseTo(STEP_M, 0);
  });

  it.each([14, 28, 44, 57])("leaves out a bus on the centerline in section %i, outside both ranges", (sectOrd) => {
    // Act & Assert
    expect(toCorridorFix(corridor, ROUTE_8800, position(0, sectOrd))).toBeNull();
  });
});

const MINUTE_MS = 60_000;

function fixAt(minutesBefore: number, alongM: number, overrides: Partial<CorridorFix> = {}): CorridorFix {
  const dataTm = new Date(SEEN_AT.getTime() - minutesBefore * MINUTE_MS);
  return { vehId: "v1", lat: 0, lng: 0, sectOrd: 50, dataTm, alongM, direction: "southbound", ...overrides };
}

describe("toSpans", () => {
  it("pairs a bus with its own position ten minutes earlier into a span with its average speed", () => {
    // Arrange
    const now = fixAt(0, 15_000);

    // Act
    const spans = toSpans("200000205", [now], [fixAt(10, 5_000)]);

    // Assert
    expect(spans).toEqual([
      {
        routeId: "200000205",
        vehId: "v1",
        direction: "southbound",
        fromAlongM: 5_000,
        toAlongM: 15_000,
        fromAt: fixAt(10, 0).dataTm,
        toAt: SEEN_AT,
        speedKmh: 60,
      },
    ]);
  });

  it.each([
    [4, false],
    [5, true],
    [15, true],
    [16, false],
  ])("accepts a partner %i minutes older: %s", (minutes, paired) => {
    // Act
    const spans = toSpans("200000205", [fixAt(0, 15_000)], [fixAt(minutes, 10_000)]);

    // Assert
    expect(spans.length === 1).toBe(paired);
  });

  it("picks the earlier position closest to ten minutes before, by GPS time", () => {
    // Act
    const spans = toSpans("200000205", [fixAt(0, 15_000)], [fixAt(6, 11_000), fixAt(9, 8_000), fixAt(13, 4_000)]);

    // Assert
    expect(spans.map((span) => span.fromAlongM)).toEqual([8_000]);
  });

  it("pairs only the same bus in the same direction", () => {
    // Arrange
    const earlier = [fixAt(10, 5_000, { vehId: "v2" }), fixAt(10, 5_000, { direction: "northbound" })];

    // Act
    const spans = toSpans("200000205", [fixAt(0, 15_000)], earlier);

    // Assert
    expect(spans).toEqual([]);
  });

  it("measures a northbound bus by the distance it covered toward the corridor's start", () => {
    // Act
    const spans = toSpans("200000205", [fixAt(0, 5_000, { direction: "northbound" })], [fixAt(10, 15_000, { direction: "northbound" })]);

    // Assert
    expect(spans).toMatchObject([{ direction: "northbound", fromAlongM: 15_000, toAlongM: 5_000, speedKmh: 60 }]);
  });

  it.each([
    ["300 m in ten minutes", 5_300, 5],
    ["100 m back, inside GPS noise", 4_900, 5],
    ["1.5 km in ten minutes", 6_500, 9],
  ])("floors a jammed bus at 5 km/h: %s", (_case, alongM, speedKmh) => {
    // Act
    const spans = toSpans("200000205", [fixAt(0, alongM)], [fixAt(10, 5_000)]);

    // Assert
    expect(spans.map((span) => span.speedKmh)).toEqual([speedKmh]);
  });

  it("drops a pair that went backward beyond GPS noise: not the same trip", () => {
    // Act
    const spans = toSpans("200000205", [fixAt(0, 4_899)], [fixAt(10, 5_000)]);

    // Assert
    expect(spans).toEqual([]);
  });
});

function spanOver(fromAlongM: number, toAlongM: number, speedKmh: number): LaneSpan {
  return { routeId: "200000205", vehId: `v${fromAlongM}`, direction: "southbound", fromAlongM, toAlongM, fromAt: SEEN_AT, toAt: SEEN_AT, speedKmh };
}

describe("toLegTime", () => {
  const LEG = { fromAlongM: 0, toAlongM: 27_700 };

  it("times 21 of 27.7 km covered from the spans, and the rest at the covered bins' harmonic mean", () => {
    // Arrange
    const spans = [spanOver(0, 10_000, 50), spanOver(10_000, 21_000, 100)];

    // Act
    const leg = toLegTime(spans, LEG);

    // Assert
    // 20 bins at 50 km/h and 22 at 100 cover 21 km; 6.7 km left take 42 / (20/50 + 22/100) km/h.
    const fillKmh = 42 / (20 / 50 + 22 / 100);
    const expectedSec = (10_000 / 50 + 11_000 / 100 + 6_700 / fillKmh) * 3.6;
    expect(leg).toEqual({ kind: "probe", corridorSec: Math.round(expectedSec), spanCount: 2, coverage: 21_000 / 27_700 });
  });

  it("refuses 15 of 27.7 km covered", () => {
    // Act
    const leg = toLegTime([spanOver(0, 15_000, 80)], LEG);

    // Assert
    expect(leg).toEqual({ kind: "unavailable", reason: "lowCoverage", spanCount: 1, coverage: 15_000 / 27_700 });
  });

  it.each([
    [5_990, "unavailable"],
    [6_000, "probe"],
    [6_010, "probe"],
  ])("needs 60%% of the leg covered: %i of 10,000 m is %s", (coveredM, kind) => {
    // Act
    const leg = toLegTime([spanOver(0, coveredM, 80)], { fromAlongM: 0, toAlongM: 10_000 });

    // Assert
    expect(leg.kind).toBe(kind);
  });

  it("averages the spans over one bin harmonically, not arithmetically", () => {
    // Act
    const leg = toLegTime([spanOver(0, 500, 20), spanOver(0, 500, 80)], { fromAlongM: 0, toAlongM: 500 });

    // Assert
    // The harmonic mean of 20 and 80 is 32 km/h (56 s); the arithmetic mean, 50 km/h, would give 36 s.
    expect(leg).toEqual({ kind: "probe", corridorSec: 56, spanCount: 2, coverage: 1 });
  });

  it("counts overlapping spans once in the coverage, and only the part inside the leg", () => {
    // Act
    const leg = toLegTime([spanOver(0, 6_000, 80), spanOver(3_000, 9_000, 80), spanOver(9_500, 12_000, 80)], { fromAlongM: 1_000, toAlongM: 11_000 });

    // Assert
    expect(leg).toMatchObject({ kind: "probe", spanCount: 3, coverage: (8_000 + 1_500) / 10_000 });
  });

  it("takes a leg given northbound, from the larger along-distance to the smaller", () => {
    // Act
    const leg = toLegTime([spanOver(0, 500, 36)], { fromAlongM: 500, toAlongM: 0 });

    // Assert
    expect(leg).toEqual({ kind: "probe", corridorSec: 50, spanCount: 1, coverage: 1 });
  });

  it("says no span reached the leg when there is none", () => {
    // Act
    const leg = toLegTime([spanOver(28_000, 29_000, 80)], LEG);

    // Assert
    expect(leg).toEqual({ kind: "unavailable", reason: "noSpans", spanCount: 0, coverage: 0 });
  });
});
