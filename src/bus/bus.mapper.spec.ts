/**
 * A Jongro route's identity in code becomes a JongroRoute: its id, the route
 * code after the `jongro` prefix and its TOPIS route id, and no TOPIS URL or
 * key, which the client builds at each call (ADR 0012, D4). The attributes are
 * stored, not part of the route (ADR 0013, D2). An instant is
 * served at +09:00, to the second, as every bus route serves one. The HSSC
 * line is named by its catalog stops in a language, as the stop page and the
 * stop list head its stations: toCatalogNamedLine moved here from
 * src/bus/stop-arrivals/bus-stop-arrivals.mapper.spec.ts, its line stations
 * reduced to the name and stop id it reads.
 */
import { toCatalogNamedLine, toJongroRoute, toKstInstant } from "./bus.mapper";

describe("toJongroRoute", () => {
  it("keeps the identity's fields and reads the code after the jongro prefix", () => {
    // Arrange
    const identity = { id: "jongro07", busRouteId: "100900004" };

    // Act
    const route = toJongroRoute(identity);

    // Assert
    expect(route).toEqual({ id: "jongro07", code: "07", busRouteId: "100900004" });
  });

  it("reads a two-digit code past 09", () => {
    // Act & Assert
    expect(toJongroRoute({ id: "jongro13", busRouteId: "1" }).code).toBe("13");
  });
});

describe("toKstInstant", () => {
  it.each([
    ["2026-10-19T16:30:00Z", "2026-10-20T01:30:00+09:00"],
    ["2026-10-18T09:07:45.400Z", "2026-10-18T18:07:45+09:00"],
  ])("%s reads %s", (instant, expected) => {
    // Act
    const read = toKstInstant(Date.parse(instant));

    // Assert
    expect(read).toBe(expected);
    expect(read).not.toBe(instant);
  });
});

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
