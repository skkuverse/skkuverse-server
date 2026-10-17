/**
 * The subway registry as loaded at import (design D2): the committed file
 * loads, and a registry with any issue fails the boot naming every issue with
 * its path in one error: a repeated station, platform, line code or subwayId;
 * a platform on an unknown line, or a second platform of one line at a
 * station; a named platform that is neither served nor a neighbor, or is on
 * another line; a previous or next neighbor without a name; a train-map name
 * on a line with no train map; a neighbor on an unknown line; and a line no
 * platform uses.
 */
import { SUBWAY_REGISTRY, loadSubwayRegistry } from "./subway.config";

const committed = require("./subway-registry.json") as Record<string, unknown>;

type Json = Record<string, unknown>;

const copyOf = (): Json => JSON.parse(JSON.stringify(committed)) as Json;

function at(raw: Json, path: readonly (string | number)[]): Json {
  return path.reduce<Json>((node, key) => (node as Record<string | number, Json>)[key] as Json, raw);
}

function issuesOf(raw: unknown): string[] {
  try {
    loadSubwayRegistry(raw);
    return [];
  } catch (err) {
    return (err as Error).message.replace(/^subway registry: /, "").split("; ");
  }
}

const SUNGKYUNKWAN = ["stations", 0, "platforms", 0] as const;
// WHY: an entry pushed onto the committed lists lands after the last one, wherever the registry has grown to.
const NEXT_STATION = (committed["stations"] as unknown[]).length;
const NEXT_LINE = (committed["lines"] as unknown[]).length;
const HYEHWA = ["stations", 1, "platforms", 0] as const;

describe("SUBWAY_REGISTRY", () => {
  it("loads the committed registry: its stations with their platforms in served order, on lines 1, 4, 2, 3, 8 and K1, so the module import in this file did not throw", () => {
    // Act
    const stations = SUBWAY_REGISTRY.stations.map((station) => [station.id, station.platforms.map((platform) => platform.id)]);

    // Assert
    expect(stations).toEqual([
      ["sungkyunkwan", ["KR-1-0153"]],
      ["hyehwa", ["S1-4-420"]],
      ["jeongja", ["KR-K1-K230"]],
      ["jamsil", ["S1-2-216", "S1-8-2815"]],
      ["dogok", ["S1-3-334", "KR-K1-K217"]],
      ["gangnam", ["S1-2-222"]],
      ["yangjae", ["S1-3-332"]],
    ]);
    expect(SUBWAY_REGISTRY.lines.map((line) => line.code)).toEqual(["1", "4", "2", "3", "8", "K1"]);
  });
});

describe("loadSubwayRegistry", () => {
  it("throws an unknown next platform and a five-digit color together, each with its path, in one error", () => {
    // Arrange
    const raw = copyOf();
    at(raw, [...SUNGKYUNKWAN, "directions", "up"])["nextPlatformId"] = "KR-1-P999";
    at(raw, ["lines", 1])["color"] = "00A5D";

    // Act
    const issues = issuesOf(raw);

    // Assert
    expect(issues).toEqual([
      expect.stringMatching(/^lines\.1\.color: /),
      'stations.0.platforms.0.directions.up.nextPlatformId: "KR-1-P999" is neither a served platform nor a neighbor',
    ]);
  });

  it.each([
    [
      "a repeated station",
      (raw: Json) => (raw["stations"] as Json[]).push({ ...at(raw, ["stations", 1]), platforms: [{ ...at(raw, HYEHWA), id: "S1-4-499" }] }),
      `stations.${NEXT_STATION}.id: station "hyehwa" is listed twice`,
    ],
    [
      "a repeated platform",
      (raw: Json) => (raw["stations"] as Json[]).push({ ...at(raw, ["stations", 1]), id: "hyehwa-two" }),
      `stations.${NEXT_STATION}.platforms.0.id: platform "S1-4-420" is listed twice`,
    ],
    [
      "a repeated line code",
      (raw: Json) => (raw["lines"] as Json[]).push({ ...at(raw, ["lines", 1]), seoul: { ...at(raw, ["lines", 1, "seoul"]), subwayId: "1099" } }),
      `lines.${NEXT_LINE}.code: line "4" is listed twice`,
    ],
    [
      "a repeated subwayId",
      (raw: Json) => (at(raw, ["lines", 1, "seoul"])["subwayId"] = "1001"),
      'lines.1.seoul.subwayId: subwayId "1001" is listed twice',
    ],
    [
      "a platform on an unknown line",
      (raw: Json) => (at(raw, HYEHWA)["line"] = "9"),
      'stations.1.platforms.0.line: "9" is not a listed line',
    ],
    [
      "two platforms of one line at one station",
      (raw: Json) => (at(raw, ["stations", 1])["platforms"] as Json[]).push({ ...at(raw, HYEHWA), id: "S1-4-499" }),
      'stations.1.platforms.1.line: station "hyehwa" has a second platform on line "4"',
    ],
    [
      "an upstream platform on another line",
      (raw: Json) => ((at(raw, [...HYEHWA, "directions", "down"])["upstreamPlatformIds"] as string[])[1] = "KR-1-P151"),
      'stations.1.platforms.0.directions.down.upstreamPlatformIds.1: "KR-1-P151" is on line "1", not "4"',
    ],
    [
      "a watched platform neither served nor a neighbor",
      (raw: Json) => (at(raw, [...SUNGKYUNKWAN, "directions", "down"])["watchedPlatformIds"] = ["KR-1-P148"]),
      'stations.0.platforms.0.directions.down.watchedPlatformIds.0: "KR-1-P148" is neither a served platform nor a neighbor',
    ],
    [
      "a previous neighbor without a name",
      (raw: Json) => delete at(raw, ["neighbors", "KR-1-P154"])["name"],
      'stations.0.platforms.0.directions.up.upstreamPlatformIds.0: neighbor "KR-1-P154" is a previous or next station and has no name',
    ],
    [
      "a next neighbor without a name",
      (raw: Json) => delete at(raw, ["neighbors", "S1-4-419"])["name"],
      'stations.1.platforms.0.directions.up.nextPlatformId: neighbor "S1-4-419" is a previous or next station and has no name',
    ],
    [
      "a train-map name on a line with no train map",
      (raw: Json) => {
        delete at(raw, ["lines", 0, "seoul"])["trainMapLine"];
        at(raw, ["neighbors", "KR-1-P149"])["trainMapName"] = "금정역";
      },
      'neighbors.KR-1-P149.trainMapName: line "1" has no train map',
    ],
    [
      "a neighbor on an unknown line",
      (raw: Json) => (at(raw, ["neighbors"])["S1-9-901"] = { line: "9", seoulName: "어딘가" }),
      'neighbors.S1-9-901.line: "9" is not a listed line',
    ],
    [
      "a line no platform uses",
      (raw: Json) => (raw["lines"] as Json[]).push({ ...at(raw, ["lines", 1]), code: "9", seoul: { ...at(raw, ["lines", 1, "seoul"]), subwayId: "1009" } }),
      `lines.${NEXT_LINE}.code: line "9" has no platform`,
    ],
  ])("throws %s with its path", (_case, arrange, issue) => {
    // Arrange
    const raw = copyOf();
    arrange(raw);

    // Act & Assert
    expect(issuesOf(raw)).toContain(issue);
  });

  it("accepts a served platform named as a neighbor stop, which takes its station's name", () => {
    // Arrange
    const raw = copyOf();
    const north = JSON.parse(JSON.stringify(at(raw, HYEHWA))) as Json;
    north["id"] = "S1-4-421";
    (raw["stations"] as Json[]).push({ ...at(raw, ["stations", 1]), id: "hyehwa-north", platforms: [north] });
    delete at(raw, ["neighbors"])["S1-4-421"];

    // Act & Assert
    expect(issuesOf(raw)).toEqual([]);
  });
});
