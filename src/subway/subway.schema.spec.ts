/**
 * subwayRegistryFile, the shape of the subway registry: the
 * registry the code's network and revision 1 of `subway-topology` join into
 * passes; a copy missing any field of a line, a station, a
 * platform, a direction, a line's marker or a neighbor fails; a slug, a
 * platform id, a color, a marker color, a Seoul station code or an upstream
 * list off its shape fails with its path, and so does a marker whose text is
 * not exactly one character (one grapheme) in any language.
 * The checks across entries are toNetworkIssues' and toTopologyIssues'.
 */
import { subwayRegistryFixture } from "../../__tests__/helpers/subway/topology";
import { subwayRegistryFile } from "./subway.schema";

// WHY: the registry readers serve from revision 1, the shape the deleted committed registry file held.
const committed = subwayRegistryFixture() as unknown as Record<string, unknown>;

type Json = Record<string, unknown>;

const copyOf = (): Json => JSON.parse(JSON.stringify(committed)) as Json;

function messagesOf(raw: unknown): string[] {
  const result = subwayRegistryFile.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

function at(raw: Json, path: readonly (string | number)[]): Json {
  return path.reduce<Json>((node, key) => (node as Record<string | number, Json>)[key] as Json, raw);
}

function without(path: readonly (string | number)[], field: string): Json {
  const raw = copyOf();
  delete at(raw, path)[field];
  return raw;
}

describe("subwayRegistryFile", () => {
  it("accepts the registry revision 1 joins into", () => {
    // Act & Assert
    expect(messagesOf(committed)).toEqual([]);
  });

  it.each([
    [[], "lines"],
    [[], "stations"],
    [[], "neighbors"],
    [["lines", 0], "code"],
    [["lines", 0], "name"],
    [["lines", 0], "marker"],
    [["lines", 0, "marker"], "text"],
    [["lines", 0, "marker"], "color"],
    [["lines", 0, "marker", "text"], "en"],
    [["lines", 0], "color"],
    [["lines", 0], "seoul"],
    [["lines", 0, "seoul"], "subwayId"],
    [["lines", 0, "seoul"], "lineName"],
    [["lines", 0, "seoul"], "trainNumbers"],
    [["stations", 0], "id"],
    [["stations", 0], "name"],
    [["stations", 0], "seoulName"],
    [["stations", 0], "platforms"],
    [["stations", 0, "platforms", 0], "id"],
    [["stations", 0, "platforms", 0], "line"],
    [["stations", 0, "platforms", 0], "timetable"],
    [["stations", 0, "platforms", 0], "directions"],
    [["stations", 0, "platforms", 0, "directions"], "up"],
    [["stations", 0, "platforms", 0, "directions", "up"], "name"],
    [["stations", 0, "platforms", 0, "directions", "up"], "upstreamPlatformIds"],
    [["stations", 0, "platforms", 0, "directions", "up"], "watchedPlatformIds"],
    [["stations", 0, "platforms", 0, "directions", "up"], "nextPlatformId"],
    [["stations", 1, "platforms", 0, "timetable"], "stationCode"],
    [["neighbors", "KR-1-P152"], "line"],
    [["neighbors", "KR-1-P152"], "seoulName"],
    [["stations", 0, "name"], "zh"],
  ] as const)("rejects a registry whose %j has no %s", (path, field) => {
    // Act
    const messages = messagesOf(without(path, field));

    // Assert
    expect(messages).toContainEqual(expect.stringMatching(new RegExp(`^${[...path, field].join("\\.")}: `)));
  });

  it("accepts a line with no train map and a neighbor with no name or train-map name", () => {
    // Arrange
    const raw = without(["lines", 0, "seoul"], "trainMapLine");
    delete at(raw, ["neighbors", "KR-1-P152"]).name;

    // Act & Assert
    expect(messagesOf(raw)).toEqual([]);
  });

  it.each([
    ["a slug with a capital", ["stations", 0], "id", "Sungkyunkwan"],
    ["a slug ending in a hyphen", ["stations", 0], "id", "gwanggyo-"],
    ["a platform id of two parts", ["stations", 0, "platforms", 0], "id", "KR-0153"],
    ["a next platform in lower case", ["stations", 0, "platforms", 0, "directions", "up"], "nextPlatformId", "kr-1-p152"],
    ["a color of five digits", ["lines", 0], "color", "0052A"],
    ["a color with a #", ["lines", 0], "color", "#0052A4"],
    ["a marker color with a #", ["lines", 0, "marker"], "color", "#0052A4"],
    ["a marker color of three digits", ["lines", 0, "marker"], "color", "05A"],
    ["a Seoul station code of three digits", ["stations", 1, "platforms", 0, "timetable"], "stationCode", "420"],
    ["four upstream platforms", ["stations", 0, "platforms", 0, "directions", "up"], "upstreamPlatformIds", ["KR-1-P154", "KR-1-P155", "KR-1-1715", "KR-1-1716"]],
    ["a numbering no line uses", ["lines", 0, "seoul"], "trainNumbers", "trip"],
    ["a timetable source of its own", ["stations", 0, "platforms", 0, "timetable"], "source", "kric"],
  ] as const)("rejects %s with its path", (_case, path, field, value) => {
    // Arrange
    const raw = copyOf();
    at(raw, path)[field] = value;

    // Act
    const messages = messagesOf(raw);

    // Assert
    expect(messages).toContainEqual(expect.stringMatching(new RegExp(`^${[...path, field].join("\\.")}`)));
  });

  it.each([
    ["ko", "two syllables", "신분"],
    ["en", "two letters", "SB"],
    ["zh", "two characters", "新盆"],
    ["en", "an empty text", ""],
  ] as const)("rejects a marker whose %s text is %s, with its path", (lang, _case, text) => {
    // Arrange
    const raw = copyOf();
    at(raw, ["lines", 0, "marker", "text"])[lang] = text;

    // Act
    const messages = messagesOf(raw);

    // Assert
    expect(messages).toEqual([`lines.0.marker.text.${lang}: must be exactly one character`]);
  });

  it.each([
    ["a Hangul syllable written as three jamo", "\u1109\u1175\u11AB"],
    ["a letter outside the basic plane", "\u{1D7D9}"],
  ])("accepts a marker text of one character that takes more than one code unit: %s", (_case, text) => {
    // Arrange
    const raw = copyOf();
    at(raw, ["lines", 0, "marker", "text"])["en"] = text;

    // Act & Assert
    expect(messagesOf(raw)).toEqual([]);
  });

  it("rejects a neighbor keyed by something other than a platform id", () => {
    // Arrange
    const raw = copyOf();
    at(raw, ["neighbors"])["의왕"] = { line: "1", seoulName: "의왕" };

    // Act & Assert
    expect(messagesOf(raw)).toContainEqual(expect.stringMatching(/^neighbors/));
  });

  it("accepts the 신분당 timetable source", () => {
    // Arrange
    const raw = copyOf();
    at(raw, ["stations", 0, "platforms", 0])["timetable"] = { source: "shinbundang" };

    // Act & Assert
    expect(messagesOf(raw)).toEqual([]);
  });

  it("rejects an unknown key, so a misspelled optional field is not dropped silently", () => {
    // Arrange
    const raw = copyOf();
    at(raw, ["neighbors", "KR-1-P152"])["trainmapName"] = "의왕";

    // Act & Assert
    expect(messagesOf(raw).length).toBeGreaterThan(0);
  });
});
