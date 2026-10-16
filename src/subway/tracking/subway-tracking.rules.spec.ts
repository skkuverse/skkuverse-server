/**
 * The per-train event history (design D3): train numbers as four digits, progress as an ordinal along the
 * train's direction, the newest of one response's duplicate rows, regressions, older rows and rows over
 * 5 minutes ahead dropped, the earlier time winning for the same progress (so a train-map row keeps the
 * crawl that first showed it), the 90 s hold for a missing train, and direction from destination and train
 * number, never from the upstream's `updnLine`.
 */
import type { TrainEvent } from "../subway.types";
import type { LineRoutes } from "../timetable/subway-timetable.types";
import {
  mergeObservations,
  toDirection,
  toDirectionByDestination,
  toLatestProgress,
  toLiveCountdownRows,
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
  return { trainNo: "0493", stationId: SUNGKYUNKWAN, state: "arrived", stateChangedAt: at("20:41:00"), destination: "서동탄", ...overrides };
}

function tick(overrides: Partial<TrackingTick>): TrackingTick {
  return { histories: new Map(), responseEvents: [], routes: ROUTES, directionByDestination: DIRECTION_BY_DESTINATION, now: at("20:41:10"), ...overrides };
}

function history(overrides: Partial<TrainHistory> = {}): TrainHistory {
  return {
    trainNo: "0493",
    direction: "down",
    destination: "서동탄",
    latest: { stationId: SUNGKYUNKWAN, state: "arrived", at: at("20:41:00"), ordinal: 10 },
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
    expect(toProgressOrdinal(DOWN_ROUTE, { stationId: SUNGKYUNKWAN, state })).toBe(ordinal);
  });

  it("orders the same station by the direction travelled", () => {
    // Act & Assert
    expect([toProgressOrdinal(ROUTES.down, { stationId: HWASEO, state: "arrived" }), toProgressOrdinal(ROUTES.up, { stationId: HWASEO, state: "arrived" })]).toEqual([13, 10]);
  });

  it("has no progress at a station off the route", () => {
    // Act & Assert
    expect(toProgressOrdinal(DOWN_ROUTE, { stationId: "KR-1-0150", state: "arrived" })).toBeNull();
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

describe("toLatestProgress", () => {
  const latest = { stationId: SUNGKYUNKWAN, state: "arrived" as const, at: at("20:41:15"), ordinal: 10 };

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
    const stale = event({ trainNo: "0496", destination: "광운대", stationId: SUNGKYUNKWAN, state: "arrived", stateChangedAt: at("20:40:00") });
    const fresh = event({ trainNo: "0496", destination: "광운대", stationId: SUNGKYUNKWAN, state: "approaching", stateChangedAt: at("20:41:00") });

    // Act
    const histories = mergeObservations(tick({ responseEvents: [[stale, fresh]] }));

    // Assert
    expect(latestOf(histories, "0496")).toEqual({ stationId: SUNGKYUNKWAN, state: "approaching", at: at("20:41:00"), ordinal: 12 });
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
    const histories = mergeObservations(tick({ responseEvents: [[event({ trainNo: "K0493", stationId: UIWANG })]] }));

    // Assert
    expect(histories.get("0493")).toEqual({
      trainNo: "0493",
      direction: "down",
      destination: "서동탄",
      latest: { stationId: UIWANG, state: "arrived", at: at("20:41:00"), ordinal: 7 },
      lastSeenAt: at("20:41:10"),
    });
  });

  it("ignores a row at a station off the line's route", () => {
    // Act
    const histories = mergeObservations(tick({ responseEvents: [[event({ stationId: "S1-4-420" })]] }));

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
    expect(latestOf(next)).toEqual({ stationId: SUNGKYUNKWAN, state: "departed", at: at("20:41:45"), ordinal: 11 });
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
    const histories = new Map([["0493", history({ latest: { stationId: SUNGKYUNKWAN, state: "arrived", at: at("20:41:15"), ordinal: 10 } })]]);

    // Act
    const next = mergeObservations(tick({ histories, now: at("20:41:20"), responseEvents: [[event({ stateChangedAt: at("20:41:02") })]] }));

    // Assert
    expect(latestOf(next)?.at).toEqual(at("20:41:02"));
  });

  it("keeps train 0692's state through a missed poll until it is back 60 seconds later", () => {
    // Arrange
    const row = event({ trainNo: "0692", destination: "광운대", stationId: HWASEO, state: "departed", stateChangedAt: at("20:31:00") });
    const seen = mergeObservations(tick({ now: at("20:31:00"), responseEvents: [[row]] }));

    // Act
    const missing = mergeObservations(tick({ histories: seen, now: at("20:31:10"), responseEvents: [[]] }));
    const back = mergeObservations(tick({ histories: missing, now: at("20:32:00"), responseEvents: [[row]] }));

    // Assert
    expect(latestOf(missing, "0692")).toEqual(latestOf(seen, "0692"));
    expect(latestOf(back, "0692")).toEqual(latestOf(seen, "0692"));
  });

  it.each([
    ["89 s", "20:42:29", true],
    ["90 s", "20:42:30", true],
    ["91 s", "20:42:31", false],
  ])("holds a train missing from every upstream for %s only within 90 seconds", (_label, kst, isKept) => {
    // Arrange
    const histories = new Map([["0493", history({ lastSeenAt: at("20:41:00") })]]);

    // Act
    const next = mergeObservations(tick({ histories, now: at(kst), responseEvents: [[], []] }));

    // Assert
    expect(next.has("0493")).toBe(isKept);
  });
});

describe("toLiveCountdownRows", () => {
  const row = { trainNo: "4674", stationId: "S1-4-420", generatedAt: at("20:40:20"), remainingSec: 150 };

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
