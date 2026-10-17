/**
 * The Seoul API rows as the tracker takes them: each position row at a
 * covered station becomes a train event at its platform id, its state from
 * `trainSttus`, its time from `recptnDt` read in KST and its number per the
 * line's numbering; each arrival row with a positive `barvlDt` becomes a
 * countdown row at the platform of its own `subwayId` at the called station,
 * while its `recptnDt` is within the arrival-row window of the fetch. Rows at
 * other stations or of unserved lines, `전역출발` rows, zero countdowns and
 * numbers the line's numbering refuses are left out; duplicates are kept for
 * the tracker to resolve. Inputs are the captured 2026-10-16 positions and the
 * 2026-10-09 and 2026-10-17 arrivals (__tests__/nest/subway/fixtures/).
 */
import fs from "fs";
import path from "path";
import type { SeoulArrivalRow, SeoulPositionRow } from "./subway-seoul-api.schema";
import { toCountdownRows, toTrainEvents } from "./subway-seoul-api.mapper";
import type { CountdownPlatform } from "./subway-seoul-api.types";

const fixture = <T>(name: string, list: string): T[] =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/subway/fixtures", name), "utf8"))[list];
const POSITIONS_LINE_1 = fixture<SeoulPositionRow>("realtime-position-line1.json", "realtimePositionList");
const POSITIONS_LINE_4 = fixture<SeoulPositionRow>("realtime-position-line4.json", "realtimePositionList");
const ARRIVALS_HYEHWA = fixture<SeoulArrivalRow>("realtime-arrival-hyehwa.json", "realtimeArrivalList");
const ARRIVALS_SUNGKYUNKWAN = fixture<SeoulArrivalRow>("realtime-arrival-sungkyunkwan.json", "realtimeArrivalList");
const ARRIVALS_GANGNAM = fixture<SeoulArrivalRow>("realtime-arrival-gangnam.json", "realtimeArrivalList");
const FETCHED_2026_10_09 = new Date("2026-10-09T13:45:00Z");
const FETCHED_2026_10_17 = new Date("2026-10-17T12:07:00Z");

const SUNGKYUNKWAN_PLATFORMS = new Map([["1001", { platformId: "KR-1-0153", trainNumbers: "timetable" as const }]]);
const HYEHWA_PLATFORMS = new Map([["1004", { platformId: "S1-4-420", trainNumbers: "timetable" as const }]]);
// WHY: line 2's own numbering is not implemented yet, so its rows are read as a timetable line here; this spec pins
// only which platform each row's countdown goes to.
const GANGNAM_LINE_2: [string, CountdownPlatform] = ["1002", { platformId: "S1-2-222", trainNumbers: "timetable" }];
const GANGNAM_SHINBUNDANG: [string, CountdownPlatform] = ["1077", { platformId: "DX-D1-4307", trainNumbers: "trainset" }];

const LINE_1 = new Map([
  ["군포", "KR-1-P150"],
  ["당정", "KR-1-P151"],
  ["의왕", "KR-1-P152"],
  ["성균관대", "KR-1-0153"],
  ["화서", "KR-1-P154"],
  ["수원", "KR-1-P155"],
  ["세류", "KR-1-1715"],
]);
const LINE_4 = new Map([
  ["길음", "S1-4-417"],
  ["성신여대입구", "S1-4-418"],
  ["한성대입구", "S1-4-419"],
  ["혜화", "S1-4-420"],
  ["동대문", "S1-4-421"],
  ["동대문역사문화공원", "S1-4-422"],
  ["충무로", "S1-4-423"],
]);

const row = (fields: Partial<SeoulPositionRow>): SeoulPositionRow => ({
  trainNo: "0493",
  statnNm: "성균관대",
  statnTnm: "서동탄",
  trainSttus: "1",
  recptnDt: "2026-10-16 20:44:10",
  ...fields,
});

describe("toTrainEvents", () => {
  it("keeps the four 1호선 trains of the 22:27 capture at covered stations, at their KRIC ids, timed in KST", () => {
    // Act
    const events = toTrainEvents(POSITIONS_LINE_1, LINE_1, "timetable");

    // Assert
    expect(events).toEqual([
      { trainNo: "0506", platformId: "KR-1-P155", state: "arrived", stateChangedAt: new Date("2026-10-16T13:26:34Z"), destination: "광운대" },
      { trainNo: "0503", platformId: "KR-1-P154", state: "arrived", stateChangedAt: new Date("2026-10-16T13:25:07Z"), destination: "병점" },
      { trainNo: "0702", platformId: "KR-1-0153", state: "approaching", stateChangedAt: new Date("2026-10-16T13:26:32Z"), destination: "구로" },
      { trainNo: "0501", platformId: "KR-1-1715", state: "arrived", stateChangedAt: new Date("2026-10-16T13:23:22Z"), destination: "서동탄" },
    ]);
  });

  it("keeps the five 4호선 trains of the 22:27 capture at covered stations", () => {
    // Act
    const events = toTrainEvents(POSITIONS_LINE_4, LINE_4, "timetable");

    // Assert
    expect(events.map((e) => [e.trainNo, e.platformId, e.state])).toEqual([
      ["4203", "S1-4-423", "arrived"],
      ["4707", "S1-4-420", "arrived"],
      ["4690", "S1-4-417", "arrived"],
      ["4205", "S1-4-418", "approaching"],
      ["4204", "S1-4-420", "arrived"],
    ]);
  });

  it.each([
    ["0", "approaching"],
    ["1", "arrived"],
    ["2", "departed"],
  ] as const)("reads trainSttus %s as %s", (trainSttus, state) => {
    // Act
    const events = toTrainEvents([row({ trainSttus })], LINE_1, "timetable");

    // Assert
    expect(events).toEqual([expect.objectContaining({ trainNo: "0493", platformId: "KR-1-0153", state })]);
  });

  it("leaves out a 전역출발 row (trainSttus 3), which names the station the train has not reached", () => {
    // Act
    const events = toTrainEvents([row({ trainSttus: "3" })], LINE_1, "timetable");

    // Assert
    expect(events).toEqual([]);
  });

  it("keeps both duplicate rows of a train, in upstream order, for the tracker to pick the newest", () => {
    // Arrange
    const rows = [row({ recptnDt: "2026-10-16 20:43:00" }), row({ recptnDt: "2026-10-16 20:44:10" })];

    // Act
    const events = toTrainEvents(rows, LINE_1, "timetable");

    // Assert
    expect(events.map((e) => e.stateChangedAt)).toEqual([new Date("2026-10-16T11:43:00Z"), new Date("2026-10-16T11:44:10Z")]);
  });

  it("reads a recptnDt after midnight KST on the next KST date", () => {
    // Act
    const [event] = toTrainEvents([row({ recptnDt: "2026-10-17 00:05:00" })], LINE_1, "timetable");

    // Assert
    expect(event?.stateChangedAt).toEqual(new Date("2026-10-16T15:05:00Z"));
    expect(event?.stateChangedAt).not.toEqual(new Date("2026-10-17T00:05:00Z"));
  });

  it("leaves out a row at a station the table does not hold", () => {
    // Act
    const events = toTrainEvents([row({ statnNm: "동대문" })], LINE_1, "timetable");

    // Assert
    expect(events).toEqual([]);
  });

  it.each([
    ["K0493", "timetable", "0493"],
    ["493", "timetable", "0493"],
    ["18", "trainset", "18"],
  ] as const)("numbers train %s on a %s line as %s", (trainNo, numbering, numbered) => {
    // Act
    const events = toTrainEvents([row({ trainNo })], LINE_1, numbering);

    // Assert
    expect(events.map((event) => event.trainNo)).toEqual([numbered]);
  });

  it("leaves out a row whose number the line's numbering refuses", () => {
    // Act
    const events = toTrainEvents([row({ trainNo: "12345" })], LINE_1, "timetable");

    // Assert
    expect(events).toEqual([]);
  });
});

describe("toCountdownRows", () => {
  it("turns each 혜화 row of 2026-10-09 22:45 into its countdown at S1-4-420, generated at recptnDt", () => {
    // Act
    const countdownRows = toCountdownRows(ARRIVALS_HYEHWA, HYEHWA_PLATFORMS, FETCHED_2026_10_09);

    // Assert
    const generatedAt = new Date("2026-10-09T13:44:20Z");
    expect(countdownRows).toEqual([
      { trainNo: "4674", platformId: "S1-4-420", generatedAt, remainingSec: 150 },
      { trainNo: "4174", platformId: "S1-4-420", generatedAt, remainingSec: 390 },
      { trainNo: "4331", platformId: "S1-4-420", generatedAt, remainingSec: 240 },
      { trainNo: "4173", platformId: "S1-4-420", generatedAt, remainingSec: 960 },
    ]);
  });

  it("gives no countdown for the 성균관대 rows, whose barvlDt is always 0", () => {
    // Act
    const countdownRows = toCountdownRows(ARRIVALS_SUNGKYUNKWAN, SUNGKYUNKWAN_PLATFORMS, FETCHED_2026_10_09);

    // Assert
    expect(ARRIVALS_SUNGKYUNKWAN).toHaveLength(4);
    expect(countdownRows).toEqual([]);
  });

  it("leaves out a row of a line the station does not serve", () => {
    // Act
    const countdownRows = toCountdownRows(ARRIVALS_HYEHWA, SUNGKYUNKWAN_PLATFORMS, FETCHED_2026_10_09);

    // Assert
    expect(countdownRows).toEqual([]);
  });

  it("gives the 강남 2호선 rows of 2026-10-17 to S1-2-222 only, and the 신분당선 rows, dated minutes ahead with no countdown, none", () => {
    // Act
    const countdownRows = toCountdownRows(ARRIVALS_GANGNAM, new Map([GANGNAM_LINE_2, GANGNAM_SHINBUNDANG]), FETCHED_2026_10_17);

    // Assert
    expect(ARRIVALS_GANGNAM.map((r) => r.subwayId)).toEqual(["1077", "1002", "1077", "1002", "1077", "1002", "1002"]);
    expect(countdownRows.map((r) => [r.trainNo, r.platformId, r.remainingSec])).toEqual([
      ["3361", "S1-2-222", 270],
      ["7363", "S1-2-222", 640],
      ["8386", "S1-2-222", 250],
      ["4388", "S1-2-222", 510],
    ]);
  });

  it("drops every 2호선 row at 강남 when the station serves only its 신분당선 platform", () => {
    // Act
    const countdownRows = toCountdownRows(ARRIVALS_GANGNAM, new Map([GANGNAM_SHINBUNDANG]), FETCHED_2026_10_17);

    // Assert
    expect(countdownRows).toEqual([]);
  });

  it("Two lines at 강남: a 2호선 row and a 신분당선 row of trains numbered alike count only for their own platform", () => {
    // Arrange
    const [line2Row] = ARRIVALS_GANGNAM.filter((r) => r.subwayId === "1002") as [SeoulArrivalRow];
    const shinbundangRow = { ...line2Row, subwayId: "1077", btrainNo: "18", barvlDt: "120" };
    const sameNumberRow = { ...line2Row, btrainNo: "18" };

    // Act
    const countdownRows = toCountdownRows([sameNumberRow, shinbundangRow], new Map([GANGNAM_LINE_2, GANGNAM_SHINBUNDANG]), FETCHED_2026_10_17);

    // Assert
    expect(countdownRows.map((r) => [r.trainNo, r.platformId, r.remainingSec])).toEqual([
      ["0018", "S1-2-222", 270],
      ["18", "DX-D1-4307", 120],
    ]);
  });

  it.each([
    ["dated 31 s ahead of the fetch", "2026-10-09 22:45:31", 0],
    ["dated 30 s ahead of the fetch", "2026-10-09 22:45:30", 1],
    ["181 s old", "2026-10-09 22:41:59", 0],
    ["180 s old", "2026-10-09 22:42:00", 1],
  ])("counts a 혜화 row %s only inside the window", (_label, recptnDt, count) => {
    // Act
    const countdownRows = toCountdownRows([{ ...ARRIVALS_HYEHWA[0]!, recptnDt }], HYEHWA_PLATFORMS, FETCHED_2026_10_09);

    // Assert
    expect(countdownRows).toHaveLength(count);
  });
});
