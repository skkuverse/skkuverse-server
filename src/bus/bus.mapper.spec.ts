/**
 * The HSSC line is named by its catalog stops in a language, as the stop page
 * and the stop list head its stations: toCatalogNamedLine moved here from
 * src/bus/stop-arrivals/bus-stop-arrivals.mapper.spec.ts, its line stations
 * reduced to the name and stop id it reads. A TOPIS route's code is stated in
 * JONGRO_ROUTES (src/bus/bus.constants.spec.ts), so no mapper reads it from
 * the id any more.
 */
import { toCatalogNamedLine } from "./bus.mapper";

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
