/**
 * The HSSC line is named by its catalog stops in a language, as the stop page
 * and the stop list head its stations: toCatalogNamedLine moved here from
 * src/bus/stop-arrivals/bus-stop-arrivals.mapper.spec.ts, its line stations
 * reduced to the name and stop id it reads. A TOPIS route's code is stated in
 * JONGRO_ROUTES (src/bus/bus.constants.spec.ts), so no mapper reads it from
 * the id any more. A stop call is served as the wire arrival with its instants
 * at +09:00, its run's fields dropped and its keys in its own order.
 */
import { toArrival, toCatalogNamedLine } from "./bus.mapper";
import type { StopCall } from "./bus.types";

describe("toCatalogNamedLine", () => {
  const station = (name: string, stopId: string | null) => ({ stopId, name });
  const line = [station("정문", "gate"), station("올림픽기념국민생활관 [하차전용]", "olympic-hall"), station("혜화동로터리 [미정차]", null)];
  const stops = [
    { id: "olympic-hall", name: { ko: "올림픽기념국민생활관", en: "Olympic Hall" } },
    { id: "gate", name: { ko: "정문", en: "Main Gate of SKKU", zh: "正门" } },
  ];

  it.each([
    ["ko", ["정문", "올림픽기념국민생활관"]],
    ["en", ["Main Gate of SKKU", "Olympic Hall"]],
    ["zh", ["正门", "Olympic Hall"]],
  ] as const)("names each stop of the line as its catalog stop in %s, English before Korean where a language is missing", (lang, expected) => {
    // Act
    const named = toCatalogNamedLine(line, stops, lang);

    // Assert
    expect(named.slice(0, 2)).toEqual([
      { name: expected[0], stopId: "gate" },
      { name: expected[1], stopId: "olympic-hall" },
    ]);
  });

  it("keeps a pass-through position, which has no stop, as the line names it", () => {
    // Act & Assert
    expect(toCatalogNamedLine(line, stops, "en")[2]).toEqual({ name: "혜화동로터리 [미정차]", stopId: null });
  });

  it("throws naming a stop id the catalog does not hold, which a push refuses", () => {
    // Act & Assert
    expect(() => toCatalogNamedLine(line, stops.slice(0, 1), "ko")).toThrow("gate");
  });
});

// WHY: every producer of an arrival (the Jongno and 7800 rows, the HSSC engine, a timetabled run) hands the wire one
// stop call, so the instants are formatted in one place and the served key order is the call's own (ADR 0019, D1).
describe("toArrival", () => {
  const call = (extra: Partial<StopCall> = {}): StopCall => ({
    status: "scheduled",
    expectedArrivalAt: new Date("2026-10-22T15:52:00Z"),
    expectedDepartureAt: null,
    scheduledArrivalAt: new Date("2026-10-22T15:50:00Z"),
    scheduledDepartureAt: new Date("2026-10-22T14:30:00.400Z"),
    basis: "estimate",
    stopsAway: null,
    isLastBus: true,
    vehicleId: null,
    providerText: null,
    runId: "commute-jamsil|down|2026-10-22|23:30",
    runDepartureAt: new Date("2026-10-22T14:30:00Z"),
    ...extra,
  });

  it("serves each instant at +09:00 to the second, KST's date past midnight where UTC's is the day before, and keeps nulls", () => {
    // Act
    const arrival = toArrival(call());

    // Assert
    expect(arrival).toEqual({
      status: "scheduled",
      expectedArrivalAt: "2026-10-23T00:52:00+09:00",
      expectedDepartureAt: null,
      scheduledArrivalAt: "2026-10-23T00:50:00+09:00",
      scheduledDepartureAt: "2026-10-22T23:30:00+09:00",
      basis: "estimate",
      stopsAway: null,
      isLastBus: true,
      vehicleId: null,
      providerText: null,
    });
    expect(arrival.expectedArrivalAt).not.toContain("2026-10-22T15");
  });

  it("drops the run's fields, which the wire arrival does not carry", () => {
    // Act & Assert
    expect(Object.keys(toArrival(call()))).not.toEqual(expect.arrayContaining(["runId"]));
    expect(toArrival(call())).not.toHaveProperty("runDepartureAt");
  });

  it("serves the keys in the call's own order, so a producer that builds them in another order keeps its bytes", () => {
    // Arrange
    const { vehicleId, isLastBus, providerText, ...rest } = call({ status: "arriving", basis: "provider", stopsAway: 0, vehicleId: "100000702" });
    const standing: StopCall = { ...rest, vehicleId, isLastBus, providerText };

    // Act
    const served = JSON.stringify(toArrival(standing));

    // Assert
    expect(served.indexOf('"vehicleId"')).toBeLessThan(served.indexOf('"isLastBus"'));
    expect(served.indexOf('"stopsAway"')).toBeLessThan(served.indexOf('"vehicleId"'));
  });
});
