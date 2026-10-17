/**
 * The Seoul Metro train map page as the tracker takes it. What it guards:
 * every train `div` of the line's blocks (`<n>line_metro` and
 * `<n>line_korail`) is read from its `class` and `title` into a four-digit
 * train number, a station name, a status and a destination; a line block
 * with no train in it is no train (line 4 at 05:16 KST on 2026-10-17, before
 * its first train), and a page with no block for the line or a train title of
 * another shape is a parse failure; each train at a covered station becomes a train event
 * stamped with the crawl time, and `이동` (between stations) none. Inputs are
 * the line 1 and line 4 pages captured on 2026-10-16
 * (__tests__/nest/subway/fixtures/, see each file's first line).
 */
import fs from "fs";
import path from "path";
import { SubwaySeoulTrainmapError } from "./subway-seoul-trainmap.error";
import { toTrainEvents, toTrainMapTrains } from "./subway-seoul-trainmap.mapper";
import type { TrainMapTrain } from "./subway-seoul-trainmap.types";

const page = (name: string): string => fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/subway/fixtures", name), "utf8");
const LINE_1_PAGE = page("trainmap-line1.html");
const LINE_4_PAGE = page("trainmap-line4.html");
const OBSERVED_AT = new Date("2026-10-16T11:45:00Z");

const LINE_1 = new Map([
  ["의왕", "KR-1-P152"],
  ["성균관대", "KR-1-0153"],
  ["화서", "KR-1-P154"],
  ["수원", "KR-1-P155"],
  ["병점", "KR-1-P157"],
]);

const train = (fields: Partial<TrainMapTrain>): TrainMapTrain => ({ trainNo: "0493", stationName: "성균관대", status: "출발", destination: "서동탄", ...fields });

function trainDiv(title: string, trainClass = "T1711_Y_2_v2 tip"): string {
  return `<div class="${trainClass}"\n     title="${title}"\n     data-statnTcd="1749" tabindex="15"></div>`;
}

function failureOf(run: () => unknown): SubwaySeoulTrainmapError {
  try {
    run();
  } catch (err) {
    return err as SubwaySeoulTrainmapError;
  }
  throw new Error("expected a parse failure");
}

describe("toTrainMapTrains", () => {
  it("reads train 0493 as departed from 성균관대 for 서동탄 on the 20:45 line 1 page", () => {
    // Act
    const trains = toTrainMapTrains(LINE_1_PAGE, "1");

    // Assert
    expect(trains).toContainEqual({ trainNo: "0493", stationName: "성균관대", status: "출발", destination: "서동탄" });
  });

  it("reads all 78 trains of line 1, from both its Seoul Metro and its Korail block, prefixes dropped", () => {
    // Act
    const trains = toTrainMapTrains(LINE_1_PAGE, "1");

    // Assert
    expect(trains).toHaveLength(78);
    expect(trains).toContainEqual({ trainNo: "0184", stationName: "동대문", status: "도착", destination: "동두천" });
    expect(trains).toContainEqual({ trainNo: "0491", stationName: "병점", status: "접근", destination: "서동탄" });
    expect(trains.every((t) => /^\d{4}$/.test(t.trainNo))).toBe(true);
  });

  it("reads all 30 trains of line 4, its Korail block's S-prefixed trains included", () => {
    // Act
    const trains = toTrainMapTrains(LINE_4_PAGE, "4");

    // Assert
    expect(trains).toHaveLength(30);
    expect(trains).toContainEqual({ trainNo: "4690", stationName: "길음", status: "도착", destination: "불암산" });
    expect(trains).toContainEqual({ trainNo: "4694", stationName: "선바위", status: "접근", destination: "불암산" });
  });

  it("reads only the asked line's blocks", () => {
    // Act
    const trains = toTrainMapTrains(`<div class="1line_metro">${trainDiv("0184열차  동대문 도착 동두천행")}</div><div class="4line_metro">${trainDiv("4690열차  길음 도착 불암산행")}</div>`, "4");

    // Assert
    expect(trains).toEqual([{ trainNo: "4690", stationName: "길음", status: "도착", destination: "불암산" }]);
  });

  it("ends a line's block where another line's Korail block starts", () => {
    // Act
    const trains = toTrainMapTrains(`<div class="1line_metro">${trainDiv("0184열차  동대문 도착 동두천행")}</div><div class="4line_korail">${trainDiv("S4694열차  선바위 접근 불암산행")}</div>`, "1");

    // Assert
    expect(trains).toEqual([{ trainNo: "0184", stationName: "동대문", status: "도착", destination: "동두천" }]);
  });

  it("keeps a station name with a parenthesized suffix as written", () => {
    // Act
    const trains = toTrainMapTrains(`<div class="4line_metro">${trainDiv("4206열차  총신대입구(이수) 출발 진접행")}</div>`, "4");

    // Assert
    expect(trains).toEqual([{ trainNo: "4206", stationName: "총신대입구(이수)", status: "출발", destination: "진접" }]);
  });

  it("reads the line's blocks with no train div as no train, as line 4's page was at 05:16 KST on 2026-10-17", () => {
    // Act
    const trains = toTrainMapTrains('<div class="4line_metro"></div><div class="4line_korail"></div>', "4");

    // Assert
    expect(trains).toEqual([]);
  });

  it.each([
    ["a page without the line's blocks", `<div class="4line_metro">${trainDiv("4690열차  길음 도착 불암산행")}</div>`],
    ["a train title of another shape", `<div class="1line_metro">${trainDiv("0493 성균관대 출발")}</div>`],
    ["a status the map never showed", `<div class="1line_metro">${trainDiv("0493열차  성균관대 정차 서동탄행")}</div>`],
    ["a train div whose class lost its station code", `<div class="1line_metro">${trainDiv("0493열차  성균관대 출발 서동탄행", "Train tip")}</div>`],
  ])("fails to parse %s", (_label, html) => {
    // Act
    const err = failureOf(() => toTrainMapTrains(html, "1"));

    // Assert
    expect(err).toBeInstanceOf(SubwaySeoulTrainmapError);
    expect(err).toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape" });
  });
});

describe("toTrainEvents", () => {
  it("turns 0493 departed from 성균관대 into a departure at KR-1-0153, stamped with the crawl time", () => {
    // Act
    const events = toTrainEvents([train({})], LINE_1, OBSERVED_AT);

    // Assert
    expect(events).toEqual([{ trainNo: "0493", platformId: "KR-1-0153", state: "departed", stateChangedAt: OBSERVED_AT, destination: "서동탄" }]);
  });

  it.each([
    ["진입", "approaching"],
    ["접근", "approaching"],
    ["도착", "arrived"],
    ["출발", "departed"],
  ] as const)("reads %s as %s", (status, state) => {
    // Act
    const events = toTrainEvents([train({ status })], LINE_1, OBSERVED_AT);

    // Assert
    expect(events).toEqual([expect.objectContaining({ state })]);
  });

  it("leaves out 이동, a train between stations, named after the station it is heading for", () => {
    // Act
    const events = toTrainEvents([train({ status: "이동" })], LINE_1, OBSERVED_AT);

    // Assert
    expect(events).toEqual([]);
  });

  it("keeps the line 1 trains of the 20:45 page at covered stations, and none elsewhere", () => {
    // Arrange
    const trains = toTrainMapTrains(LINE_1_PAGE, "1");

    // Act
    const events = toTrainEvents(trains, LINE_1, OBSERVED_AT);

    // Assert
    expect(events.map((e) => `${e.trainNo} ${e.platformId} ${e.state}`).sort()).toEqual([
      "0491 KR-1-P157 approaching",
      "0493 KR-1-0153 departed",
      "0494 KR-1-P154 departed",
      "0496 KR-1-P155 approaching",
      "0692 KR-1-P152 arrived",
      "0694 KR-1-P157 departed",
    ]);
  });
});
