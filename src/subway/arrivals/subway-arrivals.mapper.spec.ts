/**
 * toSubwayStationArrivals: a physical station and each of its platforms'
 * `subway_arrivals` documents become the arrivals response. The station
 * carries its slug, its name in the request language and the coords it is
 * handed, the camera point the app opens its sheet on, or null with none; each platform, in
 * the station's order, a line entry with the line's code, name, color and
 * marker (its one-character text in the request language and its color),
 * its KRIC id, its own document's generatedAt and each of its two
 * directions, up then down,
 * its name, its previous station (the nearest upstream one) and its next
 * station, each by id and by name in that language, and its trains; each
 * train its arrival instant as an ISO string and how many stops away it is,
 * from its stored position: 0 at the served station, 1 to 3 at an upstream
 * one, null with no position or one off the upstream list. A previous or
 * next stop it has no name for is served as null, as a terminus is, and the
 * rest of the line still serves.
 */
import { subwayRegistryFixture } from "../../../__tests__/helpers/subway/topology";
import type { SubwayArrivalsDoc } from "../subway.document";
import type { SubwayPlatform, SubwayStation } from "../subway.types";
import { toSubwayStationArrivals } from "./subway-arrivals.mapper";
import { findSubwayStation } from "./subway-arrivals.rules";

const REGISTRY = subwayRegistryFixture();
const HYEHWA = findSubwayStation("hyehwa", REGISTRY) as SubwayStation;
const SUNGKYUNKWAN = findSubwayStation("sungkyunkwan", REGISTRY) as SubwayStation;
const HYEHWA_PLATFORM = HYEHWA.platforms[0] as SubwayPlatform;
const HYEHWA_COORDS = { lat: 37.582336, lng: 127.001844 };
const GENERATED_AT = new Date("2026-10-16T11:41:00Z");
const DOC: SubwayArrivalsDoc = {
  _id: "S1-4-420",
  generatedAt: GENERATED_AT,
  serviceDate: "2026-10-16",
  directions: {
    up: [
      {
        trainNo: "4674",
        destination: "불암산",
        express: false,
        arrivalAt: new Date("2026-10-16T11:42:50Z"),
        source: "live",
        position: { stationId: "S1-4-421", state: "departed" },
      },
      { trainNo: "4676", destination: "불암산", express: false, arrivalAt: new Date("2026-10-16T11:48:00Z"), source: "scheduled", position: null },
    ],
    down: [
      {
        trainNo: "4171",
        destination: "사당",
        express: false,
        arrivalAt: new Date("2026-10-16T11:41:20Z"),
        source: "estimated",
        position: { stationId: "S1-4-420", state: "approaching" },
      },
      {
        trainNo: "4173",
        destination: "오이도",
        express: false,
        arrivalAt: new Date("2026-10-16T11:45:00Z"),
        source: "estimated",
        position: { stationId: "S1-4-418", state: "departed" },
      },
      {
        trainNo: "4175",
        destination: "오이도",
        express: false,
        arrivalAt: new Date("2026-10-16T11:49:00Z"),
        source: "estimated",
        position: { stationId: "S1-4-415", state: "arrived" },
      },
    ],
  },
};

describe("toSubwayStationArrivals", () => {
  it("names the station by its slug, its line, each direction and its neighbors in Korean, and counts each train's stops away", () => {
    // Act
    const response = toSubwayStationArrivals(HYEHWA, [{ platform: HYEHWA_PLATFORM, doc: DOC }], { lang: "ko", registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    expect(response).toEqual({
      station: { id: "hyehwa", name: "혜화", coords: { lat: 37.582336, lng: 127.001844 } },
      lines: [
        {
          line: { code: "4", name: "4호선", color: "00A5DE", marker: { text: "4", color: "007FAB" } },
          platformId: "S1-4-420",
          generatedAt: "2026-10-16T11:41:00.000Z",
          directions: [
            {
              direction: "up",
              name: "불암산·진접 방면",
              previousStation: { id: "S1-4-421", name: "동대문" },
              nextStation: { id: "S1-4-419", name: "한성대입구" },
              trains: [
                { trainNo: "4674", destination: "불암산", express: false, arrivalAt: "2026-10-16T11:42:50.000Z", stopsAway: 1, source: "live" },
                { trainNo: "4676", destination: "불암산", express: false, arrivalAt: "2026-10-16T11:48:00.000Z", stopsAway: null, source: "scheduled" },
              ],
            },
            {
              direction: "down",
              name: "오이도·안산 방면",
              previousStation: { id: "S1-4-419", name: "한성대입구" },
              nextStation: { id: "S1-4-421", name: "동대문" },
              trains: [
                { trainNo: "4171", destination: "사당", express: false, arrivalAt: "2026-10-16T11:41:20.000Z", stopsAway: 0, source: "estimated" },
                { trainNo: "4173", destination: "오이도", express: false, arrivalAt: "2026-10-16T11:45:00.000Z", stopsAway: 2, source: "estimated" },
                { trainNo: "4175", destination: "오이도", express: false, arrivalAt: "2026-10-16T11:49:00.000Z", stopsAway: null, source: "estimated" },
              ],
            },
          ],
        },
      ],
    });
  });

  it.each([
    ["en", "Hyehwa", "Line 4", ["Toward Buramsan / Jinjeop", "Toward Oido / Ansan"]],
    ["zh", "惠化", "4号线", ["佛岩山·榛接方向", "乌耳岛·安山方向"]],
  ] as const)("labels the station, its line and its directions in %s", (lang, stationName, lineName, directionNames) => {
    // Act
    const response = toSubwayStationArrivals(HYEHWA, [{ platform: HYEHWA_PLATFORM, doc: DOC }], { lang, registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    const [line] = response.lines;
    expect([response.station.name, line?.line.name, line?.directions.map((d) => d.name)]).toEqual([stationName, lineName, directionNames]);
  });

  it.each(["ko", "en", "zh"] as const)("serves the station's coords as it is handed them, the same in %s", (lang) => {
    // Arrange
    const coords = { lat: 37.300349, lng: 126.97075 };
    const platform = SUNGKYUNKWAN.platforms[0] as SubwayPlatform;

    // Act
    const response = toSubwayStationArrivals(SUNGKYUNKWAN, [{ platform, doc: { ...DOC, _id: platform.id } }], { lang, registry: REGISTRY, coords });

    // Assert
    expect(response.station).toEqual({ id: "sungkyunkwan", name: { ko: "성균관대", en: "Sungkyunkwan Univ.", zh: "成均馆大学" }[lang], coords });
  });

  it("serves null coords when it is handed none, and the rest of the station as before", () => {
    // Act
    const response = toSubwayStationArrivals(HYEHWA, [{ platform: HYEHWA_PLATFORM, doc: DOC }], { lang: "ko", registry: REGISTRY, coords: null });

    // Assert
    expect(response.station).toEqual({ id: "hyehwa", name: "혜화", coords: null });
    expect(response.lines.map((line) => line.platformId)).toEqual(["S1-4-420"]);
  });

  it.each([
    [HYEHWA, "ko", [["동대문", "한성대입구"], ["한성대입구", "동대문"]]],
    [HYEHWA, "en", [["Dongdaemun", "Hansung Univ."], ["Hansung Univ.", "Dongdaemun"]]],
    [HYEHWA, "zh", [["东大门", "汉城大入口"], ["汉城大入口", "东大门"]]],
    [SUNGKYUNKWAN, "ko", [["화서", "의왕"], ["의왕", "화서"]]],
    [SUNGKYUNKWAN, "en", [["Hwaseo", "Uiwang"], ["Uiwang", "Hwaseo"]]],
    [SUNGKYUNKWAN, "zh", [["华西", "义王"], ["义王", "华西"]]],
  ] as const)("names $0.id's previous and next stations, up then down, in %s", (station, lang, neighborNames) => {
    // Arrange
    const platform = station.platforms[0] as SubwayPlatform;

    // Act
    const response = toSubwayStationArrivals(station, [{ platform, doc: { ...DOC, _id: platform.id } }], { lang, registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    expect(response.lines[0]?.directions.map((d) => [d.previousStation?.name, d.nextStation?.name])).toEqual(neighborNames);
  });

  it("serves one line entry per platform, in the station's order, each with its own document's generatedAt", () => {
    // Arrange
    const transfer: SubwayStation = { ...HYEHWA, id: "transfer", platforms: [HYEHWA_PLATFORM, SUNGKYUNKWAN.platforms[0] as SubwayPlatform] };
    const stale = { ...DOC, _id: "KR-1-0153", generatedAt: new Date("2026-10-16T11:30:00Z"), directions: { up: [], down: [] } };

    // Act
    const response = toSubwayStationArrivals(transfer, transfer.platforms.map((platform, i) => ({ platform, doc: i === 0 ? DOC : stale })), { lang: "en", registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    expect(response.lines.map((l) => [l.line.code, l.line.marker.text, l.line.color, l.platformId, l.generatedAt])).toEqual([
      ["4", "4", "00A5DE", "S1-4-420", "2026-10-16T11:41:00.000Z"],
      ["1", "1", "0052A4", "KR-1-0153", "2026-10-16T11:30:00.000Z"],
    ]);
  });

  it.each([
    ["ko", "신분당선", "신"],
    ["en", "Shinbundang Line", "신"],
    ["zh", "新盆唐线", "新"],
  ] as const)("serves a named line's name and marker text in %s, its colors in every language", (lang, name, text) => {
    // Arrange
    const jeongja = findSubwayStation("jeongja", REGISTRY) as SubwayStation;
    const platform = jeongja.platforms[0] as SubwayPlatform;

    // Act
    const response = toSubwayStationArrivals(jeongja, [{ platform, doc: { ...DOC, _id: platform.id } }], { lang, registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    expect(response.lines[0]?.line).toEqual({ code: "D1", name, color: "D4003B", marker: { text, color: "D4003B" } });
  });

  it("serves null for a previous and a next station it has no name for, and the rest of the direction as before", () => {
    // Arrange
    const up = { ...HYEHWA_PLATFORM.directions.up, upstreamPlatformIds: ["S1-4-498", "S1-4-422", "S1-4-423"], nextPlatformId: "S1-4-499" };
    const platform: SubwayPlatform = { ...HYEHWA_PLATFORM, directions: { ...HYEHWA_PLATFORM.directions, up } };

    // Act
    const response = toSubwayStationArrivals(HYEHWA, [{ platform, doc: DOC }], { lang: "ko", registry: REGISTRY, coords: HYEHWA_COORDS });

    // Assert
    const [upDirection, downDirection] = response.lines[0]?.directions ?? [];
    expect([upDirection?.previousStation, upDirection?.nextStation]).toEqual([null, null]);
    expect([upDirection?.name, upDirection?.trains.map((train) => train.trainNo)]).toEqual(["불암산·진접 방면", ["4674", "4676"]]);
    expect(downDirection?.previousStation).toEqual({ id: "S1-4-419", name: "한성대입구" });
  });
});
