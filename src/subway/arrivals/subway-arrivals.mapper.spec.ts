/**
 * toSubwayStationArrivals: a station and its `subway_arrivals` document become
 * the arrivals response. The station carries its id, its three KRIC codes and
 * its name in the request language; each of its two directions, up then down,
 * its name in that language and its trains; each train its arrival instant as
 * an ISO string and its remaining seconds from the document's `generatedAt`,
 * with a missing position kept missing.
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
    ],
    down: [
      { trainNo: "4173", destination: "오이도", express: false, arrivalAt: new Date("2026-10-16T11:45:00Z"), source: "scheduled", position: null },
    ],
  },
};

describe("toSubwayStationArrivals", () => {
  it("names the station by its codes and each direction in Korean, and counts from generatedAt", () => {
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
          trains: [
            {
              trainNo: "4674",
              destination: "불암산",
              express: false,
              arrivalAt: "2026-10-16T11:42:50.000Z",
              remainingSec: 110,
              position: { stationId: "S1-4-421", state: "departed" },
              source: "live",
            },
          ],
        },
        {
          direction: "down",
          name: "오이도·안산 방면",
          trains: [
            {
              trainNo: "4173",
              destination: "오이도",
              express: false,
              arrivalAt: "2026-10-16T11:45:00.000Z",
              remainingSec: 240,
              position: null,
              source: "scheduled",
            },
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
});
