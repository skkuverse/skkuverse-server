/**
 * The per-train event history: train numbers as four digits, progress as an ordinal along the
 * train's direction, the newest of one response's duplicate rows, regressions, older rows and rows over
 * 5 minutes ahead dropped, the earlier time winning for the same progress (so a train-map row keeps the
 * crawl that first showed it), the 15-minute hold for a missing train, and direction from destination and
 * train number, never from the upstream's `updnLine`; a destination counts only when every train of the table
 * runs it in one direction, so line 2's Seongsu, named both ways, leaves the number to decide. An event at a station a train's timetable row does not
 * call at (an express passing it) counts as the train's departure from its last stop before that station, at
 * the latest at the event's time, so it never replaces an observed stop event; before the train's first stop,
 * and on its run into its stop at the served station, the event stays its progress, at the station it passes;
 * and a train seen at or past the served station is held 47 minutes, not 15. A served train's passed platforms are
 * the upstream ones within reach its row does not call at, after its first stop, nearest first (ADR 0022, D2).
 */
import type { TrainEvent } from "../subway.types";
import type { LineRoutes } from "../timetable/subway-timetable.types";
import {
  mergeObservations,
  toDirection,
  toDirectionByDestination,
  toLatestProgress,
  toLiveCountdownRows,
  toPassedPlatformIds,
  toProgressOrdinal,
  toTrainNo,
} from "./subway-tracking.rules";
import type { TrackingTick, TrainHistory } from "./subway-tracking.types";

const DOWN_ROUTE = ["KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-0153", "KR-1-P154", "KR-1-P155", "KR-1-1715", "KR-1-P157"];
const ROUTES: LineRoutes = { down: DOWN_ROUTE, up: [...DOWN_ROUTE].reverse() };
const DIRECTION_BY_DESTINATION = toDirectionByDestination([
  { direction: "down", destination: "서동탄" },
  { direction: "up", destination: "광운대" },
]);
const UIWANG = "KR-1-P152";
const SUNGKYUNKWAN = "KR-1-0153";
const HWASEO = "KR-1-P154";

const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);

function event(overrides: Partial<TrainEvent> = {}): TrainEvent {
  return { trainNo: "0493", platformId: SUNGKYUNKWAN, state: "arrived", stateChangedAt: at("20:41:00"), destination: "서동탄", ...overrides };
}

function tick(overrides: Partial<TrackingTick>): TrackingTick {
  return {
    histories: new Map(),
    responseEvents: [],
    routes: ROUTES,
    directionByDestination: DIRECTION_BY_DESTINATION,
    platformId: SUNGKYUNKWAN,
    stopPlatformIdsByTrainNo: new Map(),
    now: at("20:41:10"),
    ...overrides,
  };
}

function history(overrides: Partial<TrainHistory> = {}): TrainHistory {
  return {
    trainNo: "0493",
    direction: "down",
    destination: "서동탄",
    latest: { platformId: SUNGKYUNKWAN, state: "arrived", at: at("20:41:00"), ordinal: 10 },
    lastSeenAt: at("20:41:00"),
    ...overrides,
  };
}

const latestOf = (histories: ReadonlyMap<string, TrainHistory>, trainNo = "0493") => histories.get(trainNo)?.latest;

describe("toTrainNo", () => {
  it.each([
    ["K0493", "0493"],
    ["S0491", "0491"],
    ["0493", "0493"],
    ["K602", "0602"],
    ["K4302", "4302"],
    ["열차", null],
    ["K12345", null],
  ])("normalizes %s to %s", (raw, trainNo) => {
    // Act & Assert
    expect(toTrainNo(raw)).toBe(trainNo);
  });
});

describe("toProgressOrdinal", () => {
  it.each([
    ["approaching", 9],
    ["arrived", 10],
    ["departed", 11],
  ] as const)("counts %s at the fourth station of the route as %i", (state, ordinal) => {
    // Act & Assert
    expect(toProgressOrdinal(DOWN_ROUTE, { platformId: SUNGKYUNKWAN, state })).toBe(ordinal);
  });

  it("orders the same station by the direction travelled", () => {
    // Act & Assert
    expect([toProgressOrdinal(ROUTES.down, { platformId: HWASEO, state: "arrived" }), toProgressOrdinal(ROUTES.up, { platformId: HWASEO, state: "arrived" })]).toEqual([13, 10]);
  });

  it("has no progress at a station off the route", () => {
    // Act & Assert
    expect(toProgressOrdinal(DOWN_ROUTE, { platformId: "KR-1-0150", state: "arrived" })).toBeNull();
  });
});

describe("toDirection", () => {
  it("lists a train under its destination's direction, whatever its number says", () => {
    // Act & Assert
    expect([toDirection({ trainNo: "0493", destination: "광운대" }, DIRECTION_BY_DESTINATION), toDirection({ trainNo: "0496", destination: "서동탄" }, DIRECTION_BY_DESTINATION)]).toEqual([
      "up",
      "down",
    ]);
  });

  it.each([
    ["0496", "up"],
    ["0493", "down"],
    ["4302", "up"],
  ])("falls back to the number's parity for an unknown destination: %s runs %s", (trainNo, direction) => {
    // Act & Assert
    expect(toDirection({ trainNo, destination: "미상" }, DIRECTION_BY_DESTINATION)).toBe(direction);
  });
});

describe("toDirectionByDestination", () => {
  it("keeps each destination every train of the table runs in one direction", () => {
    // Act
    const directionByDestination = toDirectionByDestination([
      { direction: "up", destination: "내선순환" },
      { direction: "down", destination: "외선순환" },
      { direction: "up", destination: "내선순환" },
      { direction: "up", destination: "신도림" },
    ]);

    // Assert
    expect(directionByDestination).toEqual(new Map([["내선순환", "up"], ["외선순환", "down"], ["신도림", "up"]]));
  });

  it.each([
    ["up, then down", ["up", "down"]],
    ["down, then up", ["down", "up"]],
    ["up twice, then down", ["up", "up", "down"]],
    ["down, then up twice", ["down", "up", "up"]],
  ] as const)("leaves out a destination the table runs %s", (_label, directions) => {
    // Act
    const directionByDestination = toDirectionByDestination([...directions.map((direction) => ({ direction, destination: "성수" })), { direction: "up", destination: "내선순환" }]);

    // Assert
    expect(directionByDestination).toEqual(new Map([["내선순환", "up"]]));
  });

  it.each([
    ["2364", "up"],
    ["2363", "down"],
  ])("2호선 circle destination: lists %s, reported for 성수, which the table names both ways, under %s by its number", (trainNo, direction) => {
    // Arrange
    const directionByDestination = toDirectionByDestination([
      { direction: "up", destination: "성수" },
      { direction: "down", destination: "성수" },
      { direction: "up", destination: "내선순환" },
      { direction: "down", destination: "외선순환" },
    ]);

    // Act & Assert
    expect(toDirection({ trainNo, destination: "성수" }, directionByDestination)).toBe(direction);
  });

  it("Mislabeled direction: lists 2363, whose odd number says down, under up for its one-direction destination 내선순환", () => {
    // Arrange
    const directionByDestination = toDirectionByDestination([
      { direction: "up", destination: "성수" },
      { direction: "down", destination: "성수" },
      { direction: "up", destination: "내선순환" },
    ]);

    // Act & Assert
    expect(toDirection({ trainNo: "2363", destination: "내선순환" }, directionByDestination)).toBe("up");
  });
});

describe("toLatestProgress", () => {
  const latest = { platformId: SUNGKYUNKWAN, state: "arrived" as const, at: at("20:41:15"), ordinal: 10 };

  it("keeps the earlier time of the same progress from another source", () => {
    // Act & Assert
    expect(toLatestProgress(latest, { ...latest, at: at("20:41:05") })).toEqual({ ...latest, at: at("20:41:05") });
    expect(toLatestProgress(latest, { ...latest, at: at("20:41:30") })).toEqual(latest);
  });

  it("drops a row that moves the train backwards", () => {
    // Act & Assert
    expect(toLatestProgress(latest, { ...latest, state: "approaching", ordinal: 9, at: at("20:41:30") })).toEqual(latest);
  });

  it("drops a row older than the latest accepted event, even one further along", () => {
    // Act & Assert
    expect(toLatestProgress(latest, { ...latest, state: "departed", ordinal: 11, at: at("20:41:14") })).toEqual(latest);
  });

  it("takes a row further along and no older", () => {
    // Arrange
    const departed = { ...latest, state: "departed" as const, ordinal: 11, at: at("20:41:15") };

    // Act & Assert
    expect(toLatestProgress(latest, departed)).toEqual(departed);
  });
});

describe("mergeObservations", () => {
  it("takes only the newer of two rows one response lists for the same train", () => {
    // Arrange
    const stale = event({ trainNo: "0496", destination: "광운대", platformId: SUNGKYUNKWAN, state: "arrived", stateChangedAt: at("20:40:00") });
    const fresh = event({ trainNo: "0496", destination: "광운대", platformId: SUNGKYUNKWAN, state: "approaching", stateChangedAt: at("20:41:00") });

    // Act
    const histories = mergeObservations(tick({ responseEvents: [[stale, fresh]] }));

    // Assert
    expect(latestOf(histories, "0496")).toEqual({ platformId: SUNGKYUNKWAN, state: "approaching", at: at("20:41:00"), ordinal: 12 });
  });

  it("takes the newer row of a train however the response orders its duplicates", () => {
    // Arrange
    const fresh = event({ trainNo: "0496", destination: "광운대", state: "approaching", stateChangedAt: at("20:41:00") });
    const stale = event({ trainNo: "0496", destination: "광운대", state: "arrived", stateChangedAt: at("20:40:00") });

    // Act
    const histories = mergeObservations(tick({ responseEvents: [[fresh, stale]] }));

    // Assert
    expect(latestOf(histories, "0496")?.state).toBe("approaching");
  });

  it.each([
    ["4 m 59 s", "20:46:09", true],
    ["5 m", "20:46:10", true],
    ["5 m 1 s", "20:46:11", false],
  ])("keeps a row timestamped %s ahead of now only within 5 minutes", (_label, kst, isKept) => {
    // Act
    const histories = mergeObservations(tick({ responseEvents: [[event({ stateChangedAt: at(kst) })]] }));

    // Assert
    expect(histories.has("0493")).toBe(isKept);
  });

  it("drops a row timestamped 23:00 while the time is 12:00", () => {
    // Arrange
    const now = new Date("2026-10-16T12:00:00+09:00");

    // Act
    const histories = mergeObservations(tick({ now, responseEvents: [[event({ stateChangedAt: new Date("2026-10-16T23:00:00+09:00") })]] }));

    // Assert
    expect(histories.size).toBe(0);
  });

  it("starts a history in the destination's direction, at the row's progress, keyed by four digits", () => {
    // Act
    const histories = mergeObservations(tick({ responseEvents: [[event({ trainNo: "K0493", platformId: UIWANG })]] }));

    // Assert
    expect(histories.get("0493")).toEqual({
      trainNo: "0493",
      direction: "down",
      destination: "서동탄",
      latest: { platformId: UIWANG, state: "arrived", at: at("20:41:00"), ordinal: 7 },
      lastSeenAt: at("20:41:10"),
    });
  });

  it("ignores a row at a station off the line's route", () => {
    // Act
    const histories = mergeObservations(tick({ responseEvents: [[event({ platformId: "S1-4-420" })]] }));

    // Assert
    expect(histories.size).toBe(0);
  });

  it("records a departure the train map shows while the API still lists the train as arrived", () => {
    // Arrange
    const api = event({ state: "arrived", stateChangedAt: at("20:41:00") });
    const trainMap = event({ trainNo: "K0493", state: "departed", stateChangedAt: at("20:41:45") });

    // Act
    const first = mergeObservations(tick({ now: at("20:41:45"), responseEvents: [[api], [trainMap]] }));
    const next = mergeObservations(tick({ histories: first, now: at("20:41:55"), responseEvents: [[api]] }));

    // Assert
    expect(latestOf(next)).toEqual({ platformId: SUNGKYUNKWAN, state: "departed", at: at("20:41:45"), ordinal: 11 });
  });

  it("keeps the time of the first crawl that showed a departure", () => {
    // Arrange
    const crawl = (kst: string): TrainEvent => event({ state: "departed", stateChangedAt: at(kst) });
    const first = mergeObservations(tick({ now: at("20:41:45"), responseEvents: [[crawl("20:41:45")]] }));

    // Act
    const next = mergeObservations(tick({ histories: first, now: at("20:42:00"), responseEvents: [[crawl("20:42:00")]] }));

    // Assert
    expect(latestOf(next)?.at).toEqual(at("20:41:45"));
    expect(next.get("0493")?.lastSeenAt).toEqual(at("20:42:00"));
  });

  it("takes the API's earlier time for the progress the train map showed first", () => {
    // Arrange
    const histories = new Map([["0493", history({ latest: { platformId: SUNGKYUNKWAN, state: "arrived", at: at("20:41:15"), ordinal: 10 } })]]);

    // Act
    const next = mergeObservations(tick({ histories, now: at("20:41:20"), responseEvents: [[event({ stateChangedAt: at("20:41:02") })]] }));

    // Assert
    expect(latestOf(next)?.at).toEqual(at("20:41:02"));
  });

  it("keeps train 0692's state through a missed poll until it is back 60 seconds later", () => {
    // Arrange
    const row = event({ trainNo: "0692", destination: "광운대", platformId: HWASEO, state: "departed", stateChangedAt: at("20:31:00") });
    const seen = mergeObservations(tick({ now: at("20:31:00"), responseEvents: [[row]] }));

    // Act
    const missing = mergeObservations(tick({ histories: seen, now: at("20:31:10"), responseEvents: [[]] }));
    const back = mergeObservations(tick({ histories: missing, now: at("20:32:00"), responseEvents: [[row]] }));

    // Assert
    expect(latestOf(missing, "0692")).toEqual(latestOf(seen, "0692"));
    expect(latestOf(back, "0692")).toEqual(latestOf(seen, "0692"));
  });

  it.each([
    ["14 m 59 s", "20:55:59", true],
    ["15 m", "20:56:00", true],
    ["15 m 1 s", "20:56:01", false],
  ])("holds a train seen before 성균관대 and missing from every upstream for %s only within 15 minutes", (_label, kst, isKept) => {
    // Arrange
    // WHY: an express runs 510 s from Geumjeong to Sungkyunkwan Univ., and no upstream reliably reports it between them.
    const departedUiwang = history({ latest: { platformId: UIWANG, state: "departed", at: at("20:41:00"), ordinal: 8 } });
    const histories = new Map([["0493", departedUiwang]]);

    // Act
    const next = mergeObservations(tick({ histories, now: at(kst), responseEvents: [[], []] }));

    // Assert
    expect(next.has("0493")).toBe(isKept);
  });
});

describe("mergeObservations at stations an express passes", () => {
  const BYEONGJEOM = "KR-1-P157";
  const SERYU = "KR-1-1715";
  const SUWON = "KR-1-P155";
  // The stops of 1910, 1912 (up) and 1913 (down) among the stations of the KR-1-holiday table.
  const STOP_STATION_IDS_BY_TRAIN_NO = new Map([
    ["1910", [BYEONGJEOM, SUWON, SUNGKYUNKWAN]],
    ["1912", [BYEONGJEOM, SUWON, SUNGKYUNKWAN]],
    ["1913", [SUNGKYUNKWAN, SUWON, BYEONGJEOM]],
  ]);
  const express = (trainNo: string, platformId: string, state: TrainEvent["state"], kst: string): TrainEvent =>
    event({ trainNo, platformId, state, stateChangedAt: at(kst), destination: trainNo === "1913" ? "신창" : "청량리" });
  const expressTick = (now: string, histories: ReadonlyMap<string, TrainHistory>, ...responseEvents: TrainEvent[][]): TrackingTick =>
    tick({ histories, responseEvents, now: at(now), stopPlatformIdsByTrainNo: STOP_STATION_IDS_BY_TRAIN_NO });

  it("keeps 1912's departure from 성균관대 at 10:43:36 through its events at 의왕, a station it passes", () => {
    // Arrange
    const departed = mergeObservations(
      expressTick("10:43:36", new Map(), [express("1912", SUNGKYUNKWAN, "arrived", "10:42:01")], [express("1912", SUNGKYUNKWAN, "departed", "10:43:36")]),
    );

    // Act
    const approaching = mergeObservations(expressTick("10:44:51", departed, [express("1912", UIWANG, "approaching", "10:44:51")]));
    const passed = mergeObservations(expressTick("10:45:51", approaching, [express("1912", UIWANG, "departed", "10:45:51")]));

    // Assert
    expect(passed.get("1912")).toEqual({
      trainNo: "1912",
      direction: "up",
      destination: "청량리",
      latest: { platformId: SUNGKYUNKWAN, state: "departed", at: at("10:43:36"), ordinal: 14 },
      lastSeenAt: at("10:45:51"),
    });
  });

  it("takes 1910's first event, at 세류 which it passes, as its departure from 병점, its last stop before, at the latest then", () => {
    // Arrange
    const approaching = mergeObservations(expressTick("10:04:36", new Map(), [express("1910", SERYU, "approaching", "10:04:36")]));

    // Act
    const standing = mergeObservations(expressTick("10:06:06", approaching, [express("1910", SERYU, "arrived", "10:06:06")]));

    // Assert
    expect(latestOf(standing, "1910")).toEqual({ platformId: BYEONGJEOM, state: "departed", at: at("10:04:36"), ordinal: 2 });
  });

  it("takes 1910's next stop after the station it passed", () => {
    // Arrange
    const passing = mergeObservations(expressTick("10:08:51", new Map(), [express("1910", SERYU, "departed", "10:08:51")]));

    // Act
    const next = mergeObservations(expressTick("10:10:30", passing, [express("1910", SUWON, "approaching", "10:10:26")]));

    // Assert
    expect(latestOf(next, "1910")).toEqual({ platformId: SUWON, state: "approaching", at: at("10:10:26"), ordinal: 6 });
  });

  it.each([
    ["northbound 1912 at 의왕", "1912", UIWANG, "10:44:51", 14],
    ["southbound 1913 at 화서", "1913", HWASEO, "10:26:40", 11],
  ])("ends a stay at 성균관대 whose departure no upstream reported once %s, which it passes, is seen", (_label, trainNo, platformId, kst, ordinal) => {
    // Arrange
    const standing = mergeObservations(expressTick("10:24:00", new Map(), [express(trainNo, SUNGKYUNKWAN, "arrived", "10:24:00")]));

    // Act
    const next = mergeObservations(expressTick(kst, standing, [express(trainNo, platformId, "approaching", kst)]));

    // Assert
    expect(latestOf(next, trainNo)).toEqual({ platformId: SUNGKYUNKWAN, state: "departed", at: at(kst), ordinal });
  });

  it("keeps southbound 1913, seen only at 의왕, which it passes before its first stop, at 의왕", () => {
    // Act
    const histories = mergeObservations(expressTick("10:22:00", new Map(), [express("1913", UIWANG, "arrived", "10:22:00")]));

    // Assert
    expect(latestOf(histories, "1913")).toEqual({ platformId: UIWANG, state: "arrived", at: at("10:22:00"), ordinal: 7 });
  });

  it("keeps southbound 1935, seen departing 군포 on its run from 금정 into 성균관대, its next stop, at 군포", () => {
    // Arrange
    const geumjeongRoute = ["KR-1-P149", ...DOWN_ROUTE];
    const tick1935 = tick({
      routes: { down: geumjeongRoute, up: [...geumjeongRoute].reverse() },
      stopPlatformIdsByTrainNo: new Map([["1935", ["KR-1-P149", SUNGKYUNKWAN, SUWON]]]),
      responseEvents: [[express("1935", "KR-1-P150", "departed", "16:31:00")]],
      now: at("16:31:00"),
    });

    // Act
    const histories = mergeObservations(tick1935);

    // Assert
    expect(latestOf(histories, "1935")).toEqual({ platformId: "KR-1-P150", state: "departed", at: at("16:31:00"), ordinal: 5 });
  });

  it("moves southbound 1913 along the stations it passes before its first stop, as the 2026-10-17 train map saw it", () => {
    // Arrange
    const atDangjeong = mergeObservations(expressTick("10:21:21", new Map(), [express("1913", "KR-1-P151", "arrived", "10:21:21")]));

    // Act
    const passed = mergeObservations(expressTick("10:23:21", atDangjeong, [express("1913", UIWANG, "departed", "10:23:21")]));

    // Assert
    expect(latestOf(passed, "1913")).toEqual({ platformId: UIWANG, state: "departed", at: at("10:23:21"), ordinal: 8 });
  });
});

describe("mergeObservations of a train past the station", () => {
  const departedSungkyunkwan = history({ latest: { platformId: SUNGKYUNKWAN, state: "departed", at: at("20:41:00"), ordinal: 11 } });

  it.each([
    ["46 m 59 s", "21:27:59", true],
    ["47 m", "21:28:00", true],
    ["47 m 1 s", "21:28:01", false],
  ])("holds a train seen departing 성균관대 and missing for %s only within 47 minutes", (_label, kst, isKept) => {
    // Act
    const next = mergeObservations(tick({ histories: new Map([["0493", departedSungkyunkwan]]), now: at(kst), responseEvents: [[]] }));

    // Assert
    expect(next.has("0493")).toBe(isKept);
  });

  it.each([
    ["approaching", 9],
    ["arrived at", 10],
  ] as const)("holds a train last seen %s 성균관대 and missing for 47 minutes, like one past it", (state, ordinal) => {
    // Arrange
    const atStation = history({ latest: { platformId: SUNGKYUNKWAN, state: state === "arrived at" ? "arrived" : state, at: at("20:41:00"), ordinal } });

    // Act
    const [held, dropped] = ["21:28:00", "21:28:01"].map((kst) =>
      mergeObservations(tick({ histories: new Map([["0493", atStation]]), now: at(kst), responseEvents: [[]] })).has("0493"),
    );

    // Assert
    expect([held, dropped]).toEqual([true, false]);
  });

  it("holds a train seen at 화서, past 성균관대, after 15 minutes", () => {
    // Arrange
    const atHwaseo = history({ latest: { platformId: HWASEO, state: "arrived", at: at("20:41:00"), ordinal: 13 } });

    // Act
    const next = mergeObservations(tick({ histories: new Map([["0493", atHwaseo]]), now: at("21:20:00"), responseEvents: [[]] }));

    // Assert
    expect(next.has("0493")).toBe(true);
  });
});

describe("toLiveCountdownRows", () => {
  const row = { trainNo: "4674", platformId: "S1-4-420", generatedAt: at("20:40:20"), remainingSec: 150 };

  it.each([
    ["89 s", "20:42:29", ["4674"]],
    ["90 s", "20:42:30", ["4674"]],
    ["91 s", "20:42:31", []],
  ])("keeps a source's rows %s after its last tick only within 90 s", (_label, now, trainNos) => {
    // Arrange
    const sources = [{ observedAt: at("20:41:00"), rows: [row] }, { observedAt: at("20:41:00"), rows: [] }];

    // Act
    const rows = toLiveCountdownRows(sources, at(now));

    // Assert
    expect(rows.map((r) => r.trainNo)).toEqual(trainNos);
  });

  it("keeps one source's rows while another source's have aged out", () => {
    // Arrange
    const sources = [
      { observedAt: at("20:39:00"), rows: [{ ...row, trainNo: "4172" }] },
      { observedAt: at("20:41:00"), rows: [row] },
    ];

    // Act
    const rows = toLiveCountdownRows(sources, at("20:41:10"));

    // Assert
    expect(rows.map((r) => r.trainNo)).toEqual(["4674"]);
  });
});

describe("toPassedPlatformIds", () => {
  const SOUTHBOUND = ["KR-1-P147", "KR-1-P148", "KR-1-P149", "KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-0153", "KR-1-P154"];

  it.each([
    ["a local calling at every station", ["KR-1-P147", "KR-1-P148", "KR-1-P149", "KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-0153"], []],
    ["the express from 금정, nearest first", ["KR-1-P147", "KR-1-P149", "KR-1-0153"], ["KR-1-P152", "KR-1-P151", "KR-1-P150"]],
    ["an express passing only 당정", ["KR-1-P149", "KR-1-P150", "KR-1-P152", "KR-1-0153"], ["KR-1-P151"]],
    ["a train starting at 당정, leaving out the stations before it", ["KR-1-P151", "KR-1-P152", "KR-1-0153"], []],
  ] as const)("lists the upstream platforms within reach that %s passes", (_label, stopPlatformIds, passed) => {
    // Act
    const passedPlatformIds = toPassedPlatformIds(SOUTHBOUND, "KR-1-0153", stopPlatformIds);

    // Assert
    expect(passedPlatformIds).toEqual(passed);
  });

  it("lists none for a platform off the route", () => {
    // Act & Assert
    expect(toPassedPlatformIds(SOUTHBOUND, "S1-4-420", ["KR-1-P147"])).toEqual([]);
  });
});
