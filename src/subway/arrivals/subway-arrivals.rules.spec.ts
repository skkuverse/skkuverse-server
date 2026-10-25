/**
 * The arrivals route's lookups and decisions: a station is found by its slug
 * with its platforms, and a previous or next platform named in every language
 * (a served one by its station's name); and a train is so many stops away as its last
 * observed station says: 0 at the served station, the upstream station's
 * place in its direction's list (nearest first, from 1) at an upstream
 * station whatever its state there, and unknown (null) for a station off the
 * list, a watched one such as Geumjeong included, or a train nothing has reported.
 * A call's stops away (ADR 0022, D2) counts the stations with a stop before this one, plus one: 1 approaching
 * and 0 standing here, i + 2 approaching the upstream platform at index i and i + 1 standing at or leaving it,
 * leaving out the platforms the train's row passes, and null beyond the upstream platforms.
 */
import { subwayRegistryFixture } from "../../../__tests__/helpers/subway/topology";
import type { SubwayPlatform } from "../subway.types";
import { findPlatformName, findSubwayStation, toCallStopsAway, toStopsAway } from "./subway-arrivals.rules";

const REGISTRY = subwayRegistryFixture();

describe("toStopsAway", () => {
  const SUNGKYUNKWAN = REGISTRY.stations[0]?.platforms[0] as SubwayPlatform;
  const DOWN = SUNGKYUNKWAN.directions.down;

  it.each([
    ["approaching the served station", { stationId: "KR-1-0153", state: "approaching" }, 0],
    ["standing at the served station", { stationId: "KR-1-0153", state: "arrived" }, 0],
    ["arrived at the nearest upstream station", { stationId: "KR-1-P152", state: "arrived" }, 1],
    ["departed the nearest upstream station", { stationId: "KR-1-P152", state: "departed" }, 1],
    ["approaching the second upstream station", { stationId: "KR-1-P151", state: "approaching" }, 2],
    ["at the third upstream station", { stationId: "KR-1-P150", state: "arrived" }, 3],
    ["at a station past the upstream list", { stationId: "KR-1-P157", state: "arrived" }, null],
    ["departed 금정, the watched station beyond the upstream list", { stationId: "KR-1-P149", state: "departed" }, null],
    ["at the station after the served one", { stationId: "KR-1-P154", state: "arrived" }, null],
    ["nothing has reported", null, null],
  ] as const)("reads a 성균관대 down train %s as %p stops away", (_label, position, stopsAway) => {
    // Act
    const stops = toStopsAway(DOWN, "KR-1-0153", position);

    // Assert
    expect(stops).toBe(stopsAway);
  });
});

describe("findSubwayStation", () => {
  it.each([
    ["sungkyunkwan", ["KR-1-0153"], "성균관대", { ko: "성균관대", en: "Sungkyunkwan Univ.", zh: "成均馆大学" }],
    ["hyehwa", ["S1-4-420"], "혜화", { ko: "혜화", en: "Hyehwa", zh: "惠化" }],
    ["jeongja", ["DX-D1-4312", "KR-K1-K230"], "정자", { ko: "정자", en: "Jeongja", zh: "亭子" }],
    ["jamsil", ["S1-2-216", "S1-8-2815"], "잠실", { ko: "잠실", en: "Jamsil", zh: "蚕室" }],
    ["dogok", ["S1-3-334", "KR-K1-K217"], "도곡", { ko: "도곡", en: "Dogok", zh: "道谷" }],
    ["gangnam", ["S1-2-222", "DX-D1-4307"], "강남", { ko: "강남", en: "Gangnam", zh: "江南" }],
    ["yangjae", ["S1-3-332", "DX-D1-4308"], "양재", { ko: "양재", en: "Yangjae", zh: "良才" }],
    ["gwanggyo-jungang", ["DX-D1-4318"], "광교중앙", { ko: "광교중앙", en: "Gwanggyojungang", zh: "光教中央" }],
  ])("finds %s with its platforms, its Seoul name and its names", (slug, platformIds, seoulName, name) => {
    // Act
    const station = findSubwayStation(slug, REGISTRY);

    // Assert
    expect(station?.platforms.map((platform) => platform.id)).toEqual(platformIds);
    expect(station?.seoulName).toBe(seoulName);
    expect(station?.name).toEqual(name);
  });

  it.each(["S1-4-420", "KR-1-0153", "Hyehwa", "seoul", ""])("finds no station for %j", (slug) => {
    // Act
    const station = findSubwayStation(slug, REGISTRY);

    // Assert
    expect(station).toBeNull();
  });
});

describe("findPlatformName", () => {
  it.each([
    ["KR-1-P152", { ko: "의왕", en: "Uiwang", zh: "义王" }],
    ["KR-1-P154", { ko: "화서", en: "Hwaseo", zh: "华西" }],
    ["S1-4-419", { ko: "한성대입구", en: "Hansung Univ.", zh: "汉城大入口" }],
    ["S1-4-421", { ko: "동대문", en: "Dongdaemun", zh: "东大门" }],
    ["S1-4-420", { ko: "혜화", en: "Hyehwa", zh: "惠化" }],
    ["S1-2-215", { ko: "잠실나루", en: "Jamsillaru", zh: "蚕室渡口" }],
    ["S1-2-217", { ko: "잠실새내", en: "Jamsilsaenae", zh: "蚕室新川" }],
    ["S1-2-221", { ko: "역삼", en: "Yeoksam", zh: "驿三" }],
    ["S1-2-223", { ko: "교대", en: "Seoul Nat'l Univ. of Education", zh: "教大" }],
    ["S1-3-331", { ko: "남부터미널", en: "Nambu Bus Terminal", zh: "南部客运站" }],
    ["S1-3-333", { ko: "매봉", en: "Maebong", zh: "梅峰" }],
    ["S1-3-335", { ko: "대치", en: "Daechi", zh: "大峙" }],
    ["S1-3-332", { ko: "양재", en: "Yangjae", zh: "良才" }],
    ["S1-3-334", { ko: "도곡", en: "Dogok", zh: "道谷" }],
    ["S1-8-2814", { ko: "몽촌토성", en: "Mongchontoseong", zh: "梦村土城" }],
    ["S1-8-2816", { ko: "석촌", en: "Seokchon", zh: "石村" }],
    ["KR-K1-K216", { ko: "한티", en: "Hanti", zh: "韩峙" }],
    ["KR-K1-K218", { ko: "구룡", en: "Guryong", zh: "九龙" }],
    ["KR-K1-K229", { ko: "수내", en: "Sunae", zh: "薮内" }],
    ["KR-K1-K231", { ko: "미금", en: "Migeum", zh: "美金" }],
    ["S1-8-2815", { ko: "잠실", en: "Jamsil", zh: "蚕室" }],
    ["KR-K1-K230", { ko: "정자", en: "Jeongja", zh: "亭子" }],
    ["DX-D1-4306", { ko: "신논현", en: "Sinnonhyeon", zh: "新论岘" }],
    ["DX-D1-4309", { ko: "양재시민의숲", en: "Yangjae Citizen's Forest", zh: "良才市民之林" }],
    ["DX-D1-4311", { ko: "판교", en: "Pangyo", zh: "板桥" }],
    ["DX-D1-4317", { ko: "상현", en: "Sanghyeon", zh: "上岘" }],
    ["DX-D1-4319", { ko: "광교", en: "Gwanggyo", zh: "光教" }],
    ["DX-D1-D13", { ko: "미금", en: "Migeum", zh: "美金" }],
    ["DX-D1-4307", { ko: "강남", en: "Gangnam", zh: "江南" }],
    ["DX-D1-4308", { ko: "양재", en: "Yangjae", zh: "良才" }],
  ])("names %s in every language", (platformId, name) => {
    // Act & Assert
    expect(findPlatformName(platformId, REGISTRY)).toEqual(name);
  });

  it.each(["KR-1-P151", "S1-4-499"])("finds no name for %s, which is neither a named neighbor nor served", (platformId) => {
    // Act & Assert
    expect(findPlatformName(platformId, REGISTRY)).toBeNull();
  });
});

describe("toCallStopsAway, the call's stops away (ADR 0022, D2)", () => {
  const SUNGKYUNKWAN = REGISTRY.stations[0]?.platforms[0] as SubwayPlatform;
  // WHY: Sungkyunkwan Univ. down's upstream platforms, nearest first: Uiwang, Dangjeong, Gunpo.
  const DOWN = SUNGKYUNKWAN.directions.down;
  const at = (stationId: string, state: "approaching" | "arrived" | "departed") => ({ stationId, state });

  it.each([
    ["approaching the served platform", at("KR-1-0153", "approaching"), 1],
    ["standing at the served platform", at("KR-1-0153", "arrived"), 0],
    ["approaching 의왕, the nearest upstream platform", at("KR-1-P152", "approaching"), 2],
    ["standing at 의왕", at("KR-1-P152", "arrived"), 1],
    ["leaving 의왕", at("KR-1-P152", "departed"), 1],
    ["approaching 당정, the second", at("KR-1-P151", "approaching"), 3],
    ["standing at 당정", at("KR-1-P151", "arrived"), 2],
    ["leaving 군포, the third", at("KR-1-P150", "departed"), 3],
    ["approaching 군포", at("KR-1-P150", "approaching"), 4],
    ["at 금정, beyond the upstream platforms", at("KR-1-P149", "departed"), null],
    ["at 화서, after the served platform", at("KR-1-P154", "arrived"), null],
  ] as const)("counts a local %s as %p", (_label, position, stopsAway) => {
    // Act & Assert
    expect(toCallStopsAway(DOWN, "KR-1-0153", { position, passedPlatformIds: [] })).toBe(stopsAway);
  });

  it.each([
    ["leaving 군포, every platform before 성균관대 passed", at("KR-1-P150", "departed"), ["KR-1-P152", "KR-1-P151"], 1],
    ["approaching 당정, which it passes", at("KR-1-P151", "approaching"), ["KR-1-P151"], 2],
    ["leaving 당정, which it passes", at("KR-1-P151", "departed"), ["KR-1-P151"], 2],
    ["approaching 군포, with 의왕 and 당정 passed", at("KR-1-P150", "approaching"), ["KR-1-P152", "KR-1-P151"], 2],
  ] as const)("does not count the platforms an express's row passes: %s is %p", (_label, position, passedPlatformIds, stopsAway) => {
    // Act & Assert
    expect(toCallStopsAway(DOWN, "KR-1-0153", { position, passedPlatformIds })).toBe(stopsAway);
  });

  it("counts every upstream platform for a document written before the poller stored the passes", () => {
    // Act & Assert
    expect(toCallStopsAway(DOWN, "KR-1-0153", { position: at("KR-1-P150", "approaching") })).toBe(4);
  });

  it("knows nothing of a train nothing has reported", () => {
    // Act & Assert
    expect(toCallStopsAway(DOWN, "KR-1-0153", { position: null, passedPlatformIds: [] })).toBeNull();
  });
});
