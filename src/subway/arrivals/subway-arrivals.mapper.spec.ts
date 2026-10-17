/**
 * toSubwayStationArrivals: a station and its `subway_arrivals` document become
 * the arrivals response. The station carries its id, its three KRIC codes and
 * its name in the request language; each of its two directions, up then down,
 * its name, its previous station (the nearest upstream one) and its next
 * station, each by id and by name in that language, and its trains; each
 * train its arrival instant as an ISO string and how many stops away it is,
 * from its stored position: 0 at the served station, 1 to 3 at an upstream
 * one, null with no position or one off the upstream list. A neighbor
 * without a name is refused, never served unnamed.
 */
import { SUBWAY_STATIONS } from "../subway.constants";
import type { SubwayArrivalsDoc } from "../subway.document";
import type { SubwayStation } from "../subway.types";
import { toSubwayStationArrivals } from "./subway-arrivals.mapper";

const HYEHWA = SUBWAY_STATIONS.find((s) => s.id === "S1-4-420") as SubwayStation;
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
  it("names the station by its codes and each direction and its neighbors in Korean, and counts each train's stops away", () => {
    // Act
    const response = toSubwayStationArrivals(HYEHWA, DOC, "ko");

    // Assert
    expect(response).toEqual({
      station: { id: "S1-4-420", operatorCode: "S1", lineCode: "4", stationCode: "420", name: "혜화" },
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
    });
  });

  it.each([
    ["en", "Hyehwa", ["Toward Buramsan / Jinjeop", "Toward Oido / Ansan"]],
    ["zh", "惠化", ["佛岩山·榛接方向", "乌耳岛·安山方向"]],
  ] as const)("labels the station and its directions in %s", (lang, stationName, directionNames) => {
    // Act
    const response = toSubwayStationArrivals(HYEHWA, DOC, lang);

    // Assert
    expect([response.station.name, response.directions.map((d) => d.name)]).toEqual([stationName, directionNames]);
  });

  it.each([
    ["S1-4-420", "ko", [["동대문", "한성대입구"], ["한성대입구", "동대문"]]],
    ["S1-4-420", "en", [["Dongdaemun", "Hansung Univ."], ["Hansung Univ.", "Dongdaemun"]]],
    ["S1-4-420", "zh", [["东大门", "汉城大入口"], ["汉城大入口", "东大门"]]],
    ["KR-1-0153", "ko", [["화서", "의왕"], ["의왕", "화서"]]],
    ["KR-1-0153", "en", [["Hwaseo", "Uiwang"], ["Uiwang", "Hwaseo"]]],
    ["KR-1-0153", "zh", [["华西", "义王"], ["义王", "华西"]]],
  ] as const)("names %s's previous and next stations, up then down, in %s", (stationId, lang, neighborNames) => {
    // Arrange
    const station = SUBWAY_STATIONS.find((s) => s.id === stationId) as SubwayStation;

    // Act
    const response = toSubwayStationArrivals(station, { ...DOC, _id: stationId }, lang);

    // Assert
    expect(response.directions.map((d) => [d.previousStation?.name, d.nextStation?.name])).toEqual(neighborNames);
  });

  it("refuses a next station it has no name for rather than serving it unnamed", () => {
    // Arrange
    const up = { ...HYEHWA.directions.up, nextPlatformId: "S1-4-499" };
    const station: SubwayStation = { ...HYEHWA, directions: { ...HYEHWA.directions, up } };

    // Act & Assert
    expect(() => toSubwayStationArrivals(station, DOC, "ko")).toThrow("S1-4-499");
  });
});
