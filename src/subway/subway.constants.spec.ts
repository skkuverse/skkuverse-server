/**
 * The served lines, stations and platforms, held in code as identities and
 * their labels (ADR 0013, D2): the stations in served order with
 * their platforms, on lines 1, 4, 2, 3, 8, K1 and D1, which key the stored
 * arrival state, the timetables and the transit layout. The network passes the
 * schema the registry's identities passed (slugs, platform ids, colors,
 * one-character markers, Seoul ids), every station is filed under a campus,
 * and every line's marker color reads as small text on the app's light row
 * background.
 */
import { SUBWAY_LINES, SUBWAY_STATIONS } from "./subway.constants";
import { subwayNetwork } from "./subway.schema";

describe("SUBWAY_STATIONS", () => {
  it("lists the stations in served order with their platforms in order, 13 in all", () => {
    // Act
    const stations = SUBWAY_STATIONS.map((station) => [station.id, station.platforms.map((platform) => platform.id)]);

    // Assert
    expect(stations).toEqual([
      ["sungkyunkwan", ["KR-1-0153"]],
      ["hyehwa", ["S1-4-420"]],
      ["jeongja", ["DX-D1-4312", "KR-K1-K230"]],
      ["jamsil", ["S1-2-216", "S1-8-2815"]],
      ["dogok", ["S1-3-334", "KR-K1-K217"]],
      ["gangnam", ["S1-2-222", "DX-D1-4307"]],
      ["yangjae", ["S1-3-332", "DX-D1-4308"]],
      ["gwanggyo-jungang", ["DX-D1-4318"]],
    ]);
    expect(stations.flatMap(([, platformIds]) => platformIds)).toHaveLength(13);
  });

  it("serves each platform from its timetable source, a Seoul station's with its station code", () => {
    // Act
    const sources = SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => [platform.id, platform.line, platform.timetable]));

    // Assert
    expect(sources).toEqual([
      ["KR-1-0153", "1", { source: "korail" }],
      ["S1-4-420", "4", { source: "seoul-station", stationCode: "0420" }],
      ["DX-D1-4312", "D1", { source: "shinbundang" }],
      ["KR-K1-K230", "K1", { source: "korail" }],
      ["S1-2-216", "2", { source: "seoul-station", stationCode: "0216" }],
      ["S1-8-2815", "8", { source: "seoul-station", stationCode: "2815" }],
      ["S1-3-334", "3", { source: "seoul-station", stationCode: "0334" }],
      ["KR-K1-K217", "K1", { source: "korail" }],
      ["S1-2-222", "2", { source: "seoul-station", stationCode: "0222" }],
      ["DX-D1-4307", "D1", { source: "shinbundang" }],
      ["S1-3-332", "3", { source: "seoul-station", stationCode: "0332" }],
      ["DX-D1-4308", "D1", { source: "shinbundang" }],
      ["DX-D1-4318", "D1", { source: "shinbundang" }],
    ]);
  });

  it("names each station in every language and by the name the Seoul API writes", () => {
    // Act
    const names = SUBWAY_STATIONS.map((station) => [station.id, station.name, station.seoulName]);

    // Assert
    expect(names).toEqual([
      ["sungkyunkwan", { ko: "성균관대", en: "Sungkyunkwan Univ.", zh: "成均馆大学" }, "성균관대"],
      ["hyehwa", { ko: "혜화", en: "Hyehwa", zh: "惠化" }, "혜화"],
      ["jeongja", { ko: "정자", en: "Jeongja", zh: "亭子" }, "정자"],
      ["jamsil", { ko: "잠실", en: "Jamsil", zh: "蚕室" }, "잠실"],
      ["dogok", { ko: "도곡", en: "Dogok", zh: "道谷" }, "도곡"],
      ["gangnam", { ko: "강남", en: "Gangnam", zh: "江南" }, "강남"],
      ["yangjae", { ko: "양재", en: "Yangjae", zh: "良才" }, "양재"],
      ["gwanggyo-jungang", { ko: "광교중앙", en: "Gwanggyojungang", zh: "光教中央" }, "광교중앙"],
    ]);
  });

  it("files each station under the campus whose section of the transit tab lists it: 혜화 under hssc, the rest under nsc", () => {
    // Act
    const campuses = SUBWAY_STATIONS.map((station) => [station.id, station.campus]);

    // Assert
    expect(campuses).toEqual([
      ["sungkyunkwan", "nsc"],
      ["hyehwa", "hssc"],
      ["jeongja", "nsc"],
      ["jamsil", "nsc"],
      ["dogok", "nsc"],
      ["gangnam", "nsc"],
      ["yangjae", "nsc"],
      ["gwanggyo-jungang", "nsc"],
    ]);
  });
});

describe("SUBWAY_LINES", () => {
  it("keeps the served line order", () => {
    // Act & Assert
    expect(SUBWAY_LINES.map((line) => line.code)).toEqual(["1", "4", "2", "3", "8", "K1", "D1"]);
  });
});

describe("SUBWAY_LINES and SUBWAY_STATIONS", () => {
  it("pass subwayNetwork, the schema of the identities and their labels", () => {
    // Act
    const result = subwayNetwork.safeParse({ lines: SUBWAY_LINES, stations: SUBWAY_STATIONS });

    // Assert
    expect(result.error?.issues ?? []).toEqual([]);
  });
});

// WHY: the app's light row background (skkuverse-app SDS `bg.layerDefault`), and WCAG 2.x AA for text under 18.66 px bold.
const LIGHT_ROW_BACKGROUND = "FFFFFF";
const MIN_TEXT_CONTRAST = 4.5;

function relativeLuminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

describe("SUBWAY_LINES markers", () => {
  it("colors every line's marker so its text reads at 4.5:1 or more on the app's light row background", () => {
    // Act
    const ratios = SUBWAY_LINES.map((line) => [line.code, contrastRatio(line.marker.color, LIGHT_ROW_BACKGROUND) >= MIN_TEXT_CONTRAST]);

    // Assert
    expect(ratios).toEqual(SUBWAY_LINES.map((line) => [line.code, true]));
  });

  it("measures 수인분당's own yellow at under 2.1:1 on white, which is why its marker is darker", () => {
    // Act & Assert
    expect(contrastRatio("F5A200", LIGHT_ROW_BACKGROUND)).toBeLessThan(2.1);
  });
});
