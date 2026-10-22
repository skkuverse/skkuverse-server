/**
 * The baseline shuttle_eta document: a TMAP prediction, keyed by
 * run and source, expires 24 hours after its fetch. A prediction that reuses a
 * fixed value (ADR 0015, D8) is that value's NAVER offsets, names it in
 * `derivedFrom`, and lives 24 hours from the refresh too.
 */
import type { EtaRun } from "../bus-eta.types";
import { baselineDoc, baselineDocFromFixed } from "./bus-eta-baseline.mapper";

const RUN: EtaRun = {
  serviceId: "campus-inja",
  routeType: "regular",
  date: "2026-10-12",
  time: "10:00",
  departAt: new Date("2026-10-12T01:00:00.000Z"),
};
const FETCHED = new Date("2026-10-12T00:20:00.000Z");
// WHY: what toTmapOffsets reads from the TMAP fixture (forecast/bus-eta-forecast.rules.spec.ts).
const OFFSETS = [0, 4500, 4620];

describe("baselineDoc", () => {
  it("a prediction expires 24 hours after its fetch (TMAP terms)", () => {
    // Act
    const doc = baselineDoc(RUN, [0, 3000, 3200], FETCHED);

    // Assert
    expect(doc).toMatchObject({ _id: "campus-inja|regular|2026-10-12|10:00|baseline", kind: "baseline", source: "tmap" });
    expect(doc.expiresAt.toISOString()).toBe("2026-10-13T00:20:00.000Z");
    expect(doc).not.toHaveProperty("frozen");
  });

  it("Prediction expires after 24 hours: a baseline from it is a TMAP value that lives 24 h", () => {
    // Arrange
    const fetchedAt = new Date("2026-10-11T19:00:00Z"); // 04:00 KST
    const run = {
      serviceId: "campus-inja",
      routeType: "regular",
      date: "2026-10-12",
      time: "10:00",
      departAt: new Date("2026-10-12T01:00:00Z"),
    };

    // Act
    const doc = baselineDoc(run, OFFSETS, fetchedAt);

    // Assert
    expect(doc).toMatchObject({ source: "tmap", kind: "baseline", offsetsSec: OFFSETS });
    expect(doc.expiresAt.getTime() - fetchedAt.getTime()).toBe(24 * 3600_000);
  });
});

describe("baselineDocFromFixed", () => {
  it("is the fixed value's offsets as a NAVER prediction of the run, naming the value, for 24 hours from the refresh", () => {
    // Arrange
    const fixed = { _id: "campus-inja|regular|2026-10-05|10:00|live", serviceId: "campus-inja", routeType: "regular", date: "2026-10-05", time: "10:00", offsetsSec: [0, 4320] };

    // Act
    const doc = baselineDocFromFixed(RUN, fixed, FETCHED);

    // Assert
    expect(doc).toEqual({
      _id: "campus-inja|regular|2026-10-12|10:00|baseline",
      kind: "baseline",
      serviceId: "campus-inja",
      routeType: "regular",
      date: "2026-10-12",
      time: "10:00",
      departAt: RUN.departAt,
      offsetsSec: [0, 4320],
      source: "naver",
      fetchedAt: FETCHED,
      derivedFrom: "campus-inja|regular|2026-10-05|10:00|live",
      expiresAt: new Date("2026-10-13T00:20:00.000Z"),
    });
  });

  it("leaves derivedFrom out of a TMAP prediction", () => {
    // Act
    const doc = baselineDoc(RUN, OFFSETS, FETCHED);

    // Assert
    expect(doc).not.toHaveProperty("derivedFrom");
  });
});
