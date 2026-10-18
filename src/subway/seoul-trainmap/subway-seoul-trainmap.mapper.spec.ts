/**
 * The Seoul Metro train map page as the tracker takes it. What it guards:
 * every train `div` of the line's blocks (`<n>line_metro` and
 * `<n>line_korail`) is read from its `class` and `title` into a four-digit
 * train number, a station name, a status and a destination; a line block
 * with no train in it is no train (line 4 at 05:16 KST on 2026-10-17, before
 * its first train), and a page with no block for the line or a train title of
 * another shape is a parse failure; each train at a covered station becomes a train event
 * stamped with the crawl time, and `이동` (between stations) none. Inputs are
 * the line 1 and line 4 pages captured on 2026-10-16 and the page of every line
 * (`line=0`) captured on 2026-10-17 21:16, from which each line's blocks are
 * read alone (__tests__/nest/subway/fixtures/, see each file's first line).
 * Each line's class has its own shape: `T<code>_<Y|N>_<1|2>_` on lines 1, 3
 * and 4, line 2's direction digit 1 to 6, its branch trains' 3 to 6 dropped,
 * and line 8's `T<code>_<0|1|2>_<0|1>_`; a title names its destination with
 * the suffix for "bound for" or, for a line 2 circle train, as its inner or
 * outer circle, which becomes the destination.
 */
import fs from "fs";
import path from "path";
import { SubwaySeoulTrainmapError } from "./subway-seoul-trainmap.error";
import { toTrainEvents, toTrainMapTrains } from "./subway-seoul-trainmap.mapper";
import type { TrainMapTrain } from "./subway-seoul-trainmap.types";

const page = (name: string): string => fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/subway/fixtures", name), "utf8");
const LINE_1_PAGE = page("trainmap-line1.html");
const LINE_4_PAGE = page("trainmap-line4.html");
const ALL_LINES_PAGE = page("trainmap-all-lines.html");
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

describe("toTrainMapTrains on lines 2, 3 and 8", () => {
  it("reads the 29 main-line trains of line 2 on the page of every line, a circle train's direction as its destination", () => {
    // Act
    const trains = toTrainMapTrains(ALL_LINES_PAGE, "2");

    // Assert
    expect(trains).toHaveLength(29);
    expect(trains).toContainEqual({ trainNo: "2364", stationName: "한양대", status: "출발", destination: "내선순환" });
    expect(trains).toContainEqual({ trainNo: "2361", stationName: "역삼", status: "출발", destination: "외선순환" });
    expect(trains).toContainEqual({ trainNo: "2388", stationName: "역삼", status: "도착", destination: "신도림" });
  });

  it("drops the six line 2 branch trains of the page, whose classes carry direction digits 3 to 6", () => {
    // Act
    const trainNos = toTrainMapTrains(ALL_LINES_PAGE, "2").map((t) => t.trainNo);

    // Assert
    expect(ALL_LINES_PAGE).toContain("2683열차  신도림 도착 신도림행");
    expect(trainNos.filter((trainNo) => ["2677", "2678", "2680", "2683", "2685", "2686"].includes(trainNo))).toEqual([]);
  });

  it("Circle train on the map: reads 2364 arrived at 을지로4가 for 내선순환", () => {
    // Act
    const trains = toTrainMapTrains(`<div class="2line_metro">${trainDiv("2364열차  을지로4가 도착 내선순환", "T0203_Y_1_v2 tip")}</div>`, "2");

    // Assert
    expect(trains).toEqual([{ trainNo: "2364", stationName: "을지로4가", status: "도착", destination: "내선순환" }]);
  });

  it.each([
    ["3", "T0250_Y_3_v2 tip"],
    ["4", "T0250_Y_4_v2 tip"],
    ["5", "T0248_Y_5_v2 tip"],
    ["6", "T0249_Y_6_v2 tip"],
  ])("drops a line 2 train of direction digit %s, a branch train", (_digit, trainClass) => {
    // Act
    const trains = toTrainMapTrains(`<div class="2line_metro">${trainDiv("2677열차  용두 도착 신설동행", trainClass)}</div>`, "2");

    // Assert
    expect(trains).toEqual([]);
  });

  it("reads all 12 trains of line 8", () => {
    // Act
    const trains = toTrainMapTrains(ALL_LINES_PAGE, "8");

    // Assert
    expect(trains).toHaveLength(12);
    expect(trains).toContainEqual({ trainNo: "8207", stationName: "가락시장", status: "도착", destination: "모란" });
    expect(trains).toContainEqual({ trainNo: "8216", stationName: "남위례", status: "이동", destination: "별내" });
  });

  it("8호선 markup: reads class T2815_1_0_v2 titled 8210 departed from 잠실 for 별내", () => {
    // Act
    const trains = toTrainMapTrains(`<div class="8line_metro">${trainDiv("8210열차 잠실 출발 별내행", "T2815_1_0_v2 tip")}</div>`, "8");

    // Assert
    expect(trains).toEqual([{ trainNo: "8210", stationName: "잠실", status: "출발", destination: "별내" }]);
  });

  it("8호선 markup: reads class T2824_0_1_v2, flag 0 for 접근, titled 8057 approaching 단대오거리 for 모란", () => {
    // Act
    // WHY: the line=0 page of 2026-10-18 10:16 KST wrote this div; flag 0 marks an approaching train on line 8, as on lines 5 to 7.
    const trains = toTrainMapTrains(`<div class="8line_metro">${trainDiv("8057열차  단대오거리 접근 모란행", "T2824_0_1_v2 tip")}</div>`, "8");

    // Assert
    expect(trains).toEqual([{ trainNo: "8057", stationName: "단대오거리", status: "접근", destination: "모란" }]);
  });

  it("reads all 28 trains of line 3, its Korail block's K3312 as 3312", () => {
    // Act
    const trains = toTrainMapTrains(ALL_LINES_PAGE, "3");

    // Assert
    expect(trains).toHaveLength(28);
    expect(trains).toContainEqual({ trainNo: "3334", stationName: "도곡", status: "도착", destination: "대화" });
    expect(trains).toContainEqual(expect.objectContaining({ trainNo: "3312", stationName: "화정" }));
  });

  it.each([
    ["line 8 class in the shape of line 1's", "8", "8line_metro", "8210열차  잠실 출발 별내행", "T2815_Y_1_v2 tip"],
    ["line 8 class with direction digit 2", "8", "8line_metro", "8210열차  잠실 출발 별내행", "T2815_1_2_v2 tip"],
    ["line 1 class with a branch direction digit", "1", "1line_metro", "0493열차  성균관대 출발 서동탄행", "T1711_Y_3_v2 tip"],
    ["line 2 class with direction digit 7", "2", "2line_metro", "2364열차  을지로4가 도착 내선순환", "T0203_Y_7_v2 tip"],
    ["line 2 class in the shape of line 8's", "2", "2line_metro", "2364열차  을지로4가 도착 내선순환", "T0203_1_1_v2 tip"],
    ["circle title without its direction", "2", "2line_metro", "2364열차  을지로4가 도착 순환", "T0203_Y_1_v2 tip"],
  ])("fails to parse a %s", (_label, line, block, title, trainClass) => {
    // Act
    const err = failureOf(() => toTrainMapTrains(`<div class="${block}">${trainDiv(title, trainClass)}</div>`, line));

    // Assert
    expect(err).toBeInstanceOf(SubwaySeoulTrainmapError);
    expect(err).toMatchObject({ source: "seoul-trainmap", code: "unexpected_shape" });
  });
});

describe("toTrainEvents on lines 2 and 8", () => {
  it("gives line 2 and line 8 events at their covered stations from the page of every line", () => {
    // Arrange
    const line2 = new Map([["역삼", "S1-2-221"], ["강남", "S1-2-222"], ["교대", "S1-2-223"], ["서초", "S1-2-224"]]);
    const line8 = new Map([["몽촌토성", "S1-8-2814"], ["가락시장", "S1-8-2818"], ["강동구청", "S1-8-2813"]]);

    // Act
    const events = [...toTrainEvents(toTrainMapTrains(ALL_LINES_PAGE, "2"), line2, OBSERVED_AT), ...toTrainEvents(toTrainMapTrains(ALL_LINES_PAGE, "8"), line8, OBSERVED_AT)];

    // Assert
    expect(events.map((e) => `${e.trainNo} ${e.platformId} ${e.state} ${e.destination}`)).toEqual([
      "2361 S1-2-221 departed 외선순환",
      "2388 S1-2-221 arrived 신도림",
      "2363 S1-2-224 approaching 외선순환",
      "2386 S1-2-223 departed 내선순환",
      "8207 S1-8-2818 arrived 모란",
    ]);
  });
});

describe("toTrainMapTrains on the page of every line", () => {
  it("reads only line 1's blocks for line 1, its Korail and its Seoul Metro trains", () => {
    // Act
    const trains = toTrainMapTrains(ALL_LINES_PAGE, "1");

    // Assert
    expect(trains).toHaveLength(66);
    expect(trains.filter((t) => t.stationName === "의왕")).toEqual([{ trainNo: "0698", stationName: "의왕", status: "출발", destination: "광운대" }]);
  });

  it("reads only line 4's blocks for line 4, so 금정 on line 4 is never read as line 1's", () => {
    // Act
    const trains = toTrainMapTrains(ALL_LINES_PAGE, "4");

    // Assert
    expect(trains).toHaveLength(33);
    expect(trains.find((t) => t.trainNo === "4668")).toEqual({ trainNo: "4668", stationName: "금정", status: "출발", destination: "불암산" });
  });

  it("gives line 1 and line 4 events at their covered stations from the one page", () => {
    // Arrange
    const line4 = new Map([["길음", "S1-4-417"], ["동대문", "S1-4-421"]]);

    // Act
    const events = [...toTrainEvents(toTrainMapTrains(ALL_LINES_PAGE, "1"), LINE_1, OBSERVED_AT), ...toTrainEvents(toTrainMapTrains(ALL_LINES_PAGE, "4"), line4, OBSERVED_AT)];

    // Assert
    expect(events.map((e) => `${e.trainNo} ${e.platformId} ${e.state}`)).toEqual([
      "0698 KR-1-P152 departed",
      "0492 KR-1-P154 departed",
      "0700 KR-1-P155 approaching",
      "0489 KR-1-P155 approaching",
      "4158 S1-4-417 approaching",
      "4669 S1-4-421 arrived",
    ]);
  });
});
