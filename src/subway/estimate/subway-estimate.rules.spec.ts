/**
 * The arrival estimates (design D4, D5). A train's delay is its latest event against its own timetable row
 * (approaching = scheduled arrival − 30 s), ignored outside −120…+2,700 s, and at least how long it has stood
 * past its scheduled departure; its arrival at the served station is that station's scheduled arrival plus
 * the delay (`estimated`). An unobserved train borrows the delay of the nearest observed train ahead within
 * 30 minutes, or is served at its scheduled time (`scheduled`). A positive published countdown wins
 * (`recptnDt` + `barvlDt`, `live`), and a gap over 120 s to the timetable estimate is returned as a divergence.
 */
import type { CountdownRow, SubwayDirection } from "../subway.types";
import type { ScheduledTrain } from "../timetable/subway-timetable.types";
import type { TrainHistory, TrainProgress } from "../tracking/subway-tracking.types";
import { toDelaySec, toStationArrivals } from "./subway-estimate.rules";
import type { EstimateInput, TrainArrival } from "./subway-estimate.types";

const UIWANG = "KR-1-P152";
const SUNGKYUNKWAN = "KR-1-0153";
const HWASEO = "KR-1-P154";

const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);
const plusSec = (instant: Date, seconds: number): Date => new Date(instant.getTime() + seconds * 1000);

/** A train calling at Uiwang, Sungkyunkwan Univ. and Hwaseo in its direction's order, 210 s apart, standing 30 s at each. */
function train(trainNo: string, direction: SubwayDirection, sungkyunkwanArrival: string): ScheduledTrain {
  const arrival = at(sungkyunkwanArrival);
  const stop = (platformId: string, offsetSec: number) => ({
    platformId,
    arrivalAt: plusSec(arrival, offsetSec),
    departureAt: plusSec(arrival, offsetSec + 30),
  });
  const stations = direction === "down" ? [UIWANG, SUNGKYUNKWAN, HWASEO] : [HWASEO, SUNGKYUNKWAN, UIWANG];
  return {
    trainNo,
    direction,
    destination: direction === "down" ? "서동탄" : "광운대",
    express: false,
    stops: stations.map((platformId, index) => stop(platformId, (index - 1) * 210)),
  };
}

function history(trainNo: string, latest: Omit<TrainProgress, "ordinal">, direction: SubwayDirection = "down"): TrainHistory {
  return { trainNo, direction, destination: direction === "down" ? "서동탄" : "광운대", latest: { ...latest, ordinal: 0 }, lastSeenAt: latest.at };
}

function input(overrides: Partial<EstimateInput>): EstimateInput {
  return {
    platformId: SUNGKYUNKWAN,
    direction: "down",
    trains: [],
    histories: new Map(),
    countdownRows: [],
    isTracked: false,
    now: at("21:02:10"),
    ...overrides,
  };
}

const historiesOf = (...histories: TrainHistory[]) => new Map(histories.map((h) => [h.trainNo, h]));

/** Train 0493: Uiwang 21:00:30–21:01:00, Sungkyunkwan Univ. 21:04:00–21:04:30, Hwaseo 21:07:30–21:08:00. */
const T0493 = train("0493", "down", "21:04:00");

describe("toDelaySec", () => {
  it.each([
    ["approaching, against the arrival − 30 s", "approaching", "21:00:30", 30],
    ["arrived, against the arrival", "arrived", "21:02:00", 90],
    ["departed, against the departure", "departed", "21:01:30", 30],
  ] as const)("measures a train %s", (_label, state, kst, delaySec) => {
    // Act & Assert
    expect(toDelaySec(T0493, { platformId: UIWANG, state, at: at(kst), ordinal: 0 }, at(kst))).toBe(delaySec);
  });

  it.each([
    ["121 s early", -121, null],
    ["120 s early", -120, -120],
    ["119 s early", -119, -119],
    ["2,699 s late", 2699, 2699],
    ["2,700 s late", 2700, 2700],
    ["2,701 s late", 2701, null],
  ])("keeps a delay of %s only inside −120…+2,700 s", (_label, offsetSec, delaySec) => {
    // Arrange
    const departedAt = plusSec(at("21:01:00"), offsetSec);

    // Act & Assert
    expect(toDelaySec(T0493, { platformId: UIWANG, state: "departed", at: departedAt, ordinal: 0 }, departedAt)).toBe(delaySec);
  });

  it.each([
    ["at its scheduled departure", "21:01:00", 0],
    ["1 s past its scheduled departure", "21:01:01", 1],
    ["60 s past its scheduled departure", "21:02:00", 60],
  ])("counts a train that arrived on time and still stands %s as that late", (_label, now, delaySec) => {
    // Act & Assert
    expect(toDelaySec(T0493, { platformId: UIWANG, state: "arrived", at: at("21:00:30"), ordinal: 0 }, at(now))).toBe(delaySec);
  });

  it("keeps the larger observed delay while a train stands", () => {
    // Act & Assert
    expect(toDelaySec(T0493, { platformId: UIWANG, state: "arrived", at: at("21:02:00"), ordinal: 0 }, at("21:02:10"))).toBe(90);
  });

  it("has no delay at a station the train's row does not call at", () => {
    // Act & Assert
    expect(toDelaySec(T0493, { platformId: "KR-1-P151", state: "arrived", at: at("21:00:00"), ordinal: 0 }, at("21:00:00"))).toBeNull();
  });
});

describe("toStationArrivals", () => {
  it("serves southbound 0493, 90 s late arriving at 의왕, at 성균관대 at 21:05:30 as estimated", () => {
    // Arrange
    const histories = historiesOf(history("0493", { platformId: UIWANG, state: "arrived", at: at("21:02:00") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("21:02:10") }));

    // Assert
    expect(arrivals).toEqual([
      {
        trainNo: "0493",
        direction: "down",
        destination: "서동탄",
        express: false,
        arrivalAt: at("21:05:30"),
        source: "estimated",
        position: { platformId: UIWANG, state: "arrived" },
      },
    ]);
  });

  it("serves a train standing at 의왕 past its departure later the longer it stands", () => {
    // Arrange
    const histories = historiesOf(history("0493", { platformId: UIWANG, state: "arrived", at: at("21:00:30") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("21:02:00") }));

    // Assert
    expect(arrivals[0]?.arrivalAt).toEqual(at("21:05:00"));
  });

  it("lends the delay of the train ahead, 60 s late, to the next northbound train still at its origin", () => {
    // Arrange
    const ahead = train("0492", "up", "21:04:00");
    const next = train("0494", "up", "21:14:00");
    const histories = historiesOf(history("0492", { platformId: HWASEO, state: "departed", at: at("21:02:00") }, "up"));

    // Act
    const { arrivals } = toStationArrivals(input({ direction: "up", trains: [next, ahead], histories, now: at("21:02:00") }));

    // Assert
    expect(arrivals.map((a) => [a.trainNo, a.arrivalAt, a.source, a.position])).toEqual([
      ["0492", at("21:05:00"), "estimated", { platformId: HWASEO, state: "departed" }],
      ["0494", at("21:15:00"), "estimated", null],
    ]);
  });

  it("lends the delay of the nearest observed train ahead, not of one further ahead", () => {
    // Arrange
    const trains = [train("0491", "down", "20:54:00"), T0493, train("0495", "down", "21:14:00")];
    const histories = historiesOf(
      history("0491", { platformId: HWASEO, state: "departed", at: at("20:58:30") }),
      history("0493", { platformId: UIWANG, state: "arrived", at: at("21:02:00") }),
    );

    // Act
    const { arrivals } = toStationArrivals(input({ trains, histories }));

    // Assert
    expect(arrivals.find((a) => a.trainNo === "0495")?.arrivalAt).toEqual(at("21:15:30"));
  });

  it("serves the first train of the day, with no observation and no train ahead, at its scheduled time", () => {
    // Arrange
    const first = train("0401", "down", "06:14:00");

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [first], now: at("05:50:00") }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("06:14:00"), "scheduled"]]);
  });

  it.each([
    ["29 m 59 s", "21:33:59", "estimated"],
    ["30 m", "21:34:00", "estimated"],
    ["30 m 1 s", "21:34:01", "scheduled"],
  ])("lends a delay to a train %s behind only within 30 minutes", (_label, kst, source) => {
    // Arrange
    const histories = historiesOf(history("0493", { platformId: UIWANG, state: "arrived", at: at("21:02:00") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493, train("0495", "down", kst)], histories }));

    // Assert
    expect(arrivals.find((a) => a.trainNo === "0495")?.source).toBe(source);
  });

  it("serves a train whose delay is out of range like an unobserved one, a likely train-number mismatch", () => {
    // Arrange
    const histories = historiesOf(history("0493", { platformId: UIWANG, state: "arrived", at: at("20:58:29") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("20:58:30") }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source, a.position])).toEqual([[at("21:04:00"), "scheduled", null]]);
  });

  it.each([
    ["departed 성균관대", SUNGKYUNKWAN, "departed"],
    ["arrived at 화서", HWASEO, "arrived"],
  ] as const)("leaves out a train observed to have %s", (_label, platformId, state) => {
    // Arrange
    const histories = historiesOf(history("0493", { platformId, state, at: at("21:04:30") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("21:04:40") }));

    // Assert
    expect(arrivals).toEqual([]);
  });

  it("lists a train standing at 성균관대 at its observed arrival while it stands", () => {
    // Arrange
    const histories = historiesOf(history("0493", { platformId: SUNGKYUNKWAN, state: "arrived", at: at("21:04:00") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("21:05:00") }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("21:04:00"), "estimated"]]);
  });

  it("leaves out an unobserved train once its estimated departure from the station has passed", () => {
    // Act
    const listed = ["21:04:30", "21:04:31"].map((now) => toStationArrivals(input({ trains: [T0493], now: at(now) })).arrivals.length);

    // Assert
    expect(listed).toEqual([1, 0]);
  });

  it("lists only the station's direction, ordered by arrival", () => {
    // Arrange
    const trains = [train("0497", "down", "21:24:00"), train("0492", "up", "21:05:00"), train("0495", "down", "21:14:00")];

    // Act
    const { arrivals } = toStationArrivals(input({ trains, now: at("21:00:00") }));

    // Assert
    expect(arrivals.map((a) => a.trainNo)).toEqual(["0495", "0497"]);
  });

  it("serves a 혜화 row generated 40 s ago with barvlDt 150 as live, 110 s from now", () => {
    // Arrange
    const now = at("21:02:10");
    const row: CountdownRow = { trainNo: "0493", platformId: SUNGKYUNKWAN, generatedAt: plusSec(now, -40), remainingSec: 150 };

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], countdownRows: [row], now }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[plusSec(now, 110), "live"]]);
  });

  it("computes a zero countdown as a train without one, never as arriving now", () => {
    // Arrange
    const row: CountdownRow = { trainNo: "0493", platformId: SUNGKYUNKWAN, generatedAt: at("21:02:00"), remainingSec: 0 };

    // Act
    const { arrivals, divergences } = toStationArrivals(input({ trains: [T0493], countdownRows: [row] }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("21:04:00"), "scheduled"]]);
    expect(divergences).toEqual([]);
  });

  it("reads a countdown only from a row for the station and the train", () => {
    // Arrange
    const rows: CountdownRow[] = [
      { trainNo: "0493", platformId: UIWANG, generatedAt: at("21:02:00"), remainingSec: 30 },
      { trainNo: "0495", platformId: SUNGKYUNKWAN, generatedAt: at("21:02:00"), remainingSec: 30 },
    ];

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], countdownRows: rows }));

    // Assert
    expect(arrivals.map((a) => a.source)).toEqual(["scheduled"]);
  });

  it.each([
    ["119 s", 119, false],
    ["120 s", 120, false],
    ["121 s", 121, true],
  ])("keeps the live arrival %s from the timetable estimate, returning a divergence only over 120 s", (_label, gapSec, isDivergent) => {
    // Arrange
    const generatedAt = at("21:02:00");
    const row: CountdownRow = { trainNo: "0493", platformId: SUNGKYUNKWAN, generatedAt, remainingSec: 120 + gapSec };

    // Act
    const { arrivals, divergences } = toStationArrivals(input({ trains: [T0493], countdownRows: [row] }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[plusSec(generatedAt, 120 + gapSec), "live"]]);
    expect(divergences).toEqual(
      isDivergent
        ? [{ trainNo: "0493", platformId: SUNGKYUNKWAN, liveArrivalAt: plusSec(generatedAt, 120 + gapSec), estimatedArrivalAt: at("21:04:00"), divergenceSec: gapSec }]
        : [],
    );
  });
});

/** A train with its own stops, as `[platformId, arrival, departure]` in KST, for the trains observed on 2026-10-17. */
function trainWithStops(trainNo: string, direction: SubwayDirection, stops: readonly [string, string | null, string][]): ScheduledTrain {
  const destination = direction === "down" ? "오이도" : "불암산";
  return {
    trainNo,
    direction,
    destination,
    express: false,
    stops: stops.map(([platformId, arrival, departure]) => ({ platformId, arrivalAt: arrival ? at(arrival) : null, departureAt: at(departure) })),
  };
}

const HYEHWA = "S1-4-420";

/** Train 0645 on the 2026-10-17 holiday table: Uiwang 10:43:00–10:43:30, Sungkyunkwan Univ. 10:46:30–10:47:00, Hwaseo 10:49:30–10:50:00. */
const T0645 = trainWithStops("0645", "down", [
  [UIWANG, "10:43:00", "10:43:30"],
  [SUNGKYUNKWAN, "10:46:30", "10:47:00"],
  [HWASEO, "10:49:30", "10:50:00"],
]);

/** Train 0435 on the 2026-10-17 holiday table: Sungkyunkwan Univ. 10:58:00–10:58:30. */
const T0435 = trainWithStops("0435", "down", [
  [UIWANG, "10:54:30", "10:55:00"],
  [SUNGKYUNKWAN, "10:58:00", "10:58:30"],
  [HWASEO, "11:01:00", "11:01:30"],
]);

/** Train 4555 on the 2026-10-17 Saturday table, southbound through Hyehwa at 10:55:00–10:55:30. */
const T4555 = trainWithStops("4555", "down", [
  ["S1-4-418", "10:51:00", "10:51:30"],
  ["S1-4-419", "10:53:00", "10:53:30"],
  [HYEHWA, "10:55:00", "10:55:30"],
  ["S1-4-421", "10:57:30", "10:58:00"],
]);

describe("toStationArrivals, for a train last seen at the served station", () => {
  it("stops listing 0645, last seen arrived at 성균관대 at 10:46:51 and absent from the train map, 90 s past its estimated departure", () => {
    // Arrange
    const histories = historiesOf(history("0645", { platformId: SUNGKYUNKWAN, state: "arrived", at: at("10:46:51") }));

    // Act
    const listed = ["10:48:12", "10:48:51", "10:48:52", "10:49:00"].map((now) =>
      toStationArrivals(input({ trains: [T0645], histories, now: at(now) })).arrivals.map((a) => a.arrivalAt),
    );

    // Assert
    // WHY: the API reported it at Hwaseo only at 10:49:09, and its departure never came; 10:47:21 + 90 s is 10:48:51.
    expect(listed).toEqual([[at("10:46:51")], [at("10:46:51")], [], []]);
  });

  it("keeps 0435's arrival at the observed 10:58:33 while it stands, and drops it 90 s past its estimated departure of 10:59:03", () => {
    // Arrange
    const histories = historiesOf(history("0435", { platformId: SUNGKYUNKWAN, state: "arrived", at: at("10:58:33") }));

    // Act
    const served = ["10:59:12", "11:00:12", "11:00:34"].map((now) =>
      toStationArrivals(input({ trains: [T0435], histories, now: at(now) })).arrivals.map((a) => [a.arrivalAt, a.source]),
    );

    // Assert
    expect(served).toEqual([[[at("10:58:33"), "estimated"]], [[at("10:58:33"), "estimated"]], []]);
  });

  it.each([
    ["89 s", "21:05:59", 1],
    ["90 s", "21:06:00", 1],
    ["91 s", "21:06:01", 0],
  ])("lists a train arrived on time at 성균관대 %s past its estimated departure only up to 90 s", (_label, now, count) => {
    // Arrange
    const histories = historiesOf(history("0493", { platformId: SUNGKYUNKWAN, state: "arrived", at: at("21:04:00") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at(now) }));

    // Assert
    expect(arrivals).toHaveLength(count);
  });

  it("serves a train approaching 성균관대 30 s after its approach, however long it is then seen there", () => {
    // Arrange
    const histories = historiesOf(history("0493", { platformId: SUNGKYUNKWAN, state: "approaching", at: at("21:04:10") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("21:05:30") }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("21:04:40"), "estimated"]]);
  });
});

describe("toStationArrivals, with a published countdown and the train's position", () => {
  it("serves 4555, arrived at 혜화 at 10:54:56, at that arrival and not from its countdown of 120 s published at 10:54:25", () => {
    // Arrange
    const histories = historiesOf(history("4555", { platformId: HYEHWA, state: "arrived", at: at("10:54:56") }));
    const row: CountdownRow = { trainNo: "4555", platformId: HYEHWA, generatedAt: at("10:54:25"), remainingSec: 120 };

    // Act
    const { arrivals, divergences } = toStationArrivals(
      input({ platformId: HYEHWA, trains: [T4555], histories, countdownRows: [row], now: at("10:55:12") }),
    );

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("10:54:56"), "estimated"]]);
    expect(divergences).toEqual([]);
  });

  it.each([
    ["approaching 혜화", HYEHWA, "approaching", "estimated"],
    ["arrived at 혜화", HYEHWA, "arrived", "estimated"],
    ["departed 한성대입구, the station before", "S1-4-419", "departed", "live"],
  ] as const)("reads the countdown of a train %s only when it is not at the station", (_label, platformId, state, source) => {
    // Arrange
    const histories = historiesOf(history("4555", { platformId, state, at: at("10:54:50") }));
    const row: CountdownRow = { trainNo: "4555", platformId: HYEHWA, generatedAt: at("10:54:25"), remainingSec: 120 };

    // Act
    const { arrivals } = toStationArrivals(input({ platformId: HYEHWA, trains: [T4555], histories, countdownRows: [row], now: at("10:54:55") }));

    // Assert
    expect(arrivals.map((a) => a.source)).toEqual([source]);
  });
});

describe("toStationArrivals, with a countdown far from the timetable", () => {
  it("serves first train 4507, standing at its origin 한성대입구 since 05:01, at its scheduled 05:38:30 instead of a countdown to 05:03:10", () => {
    // Arrange
    const t4507 = trainWithStops("4507", "down", [
      ["S1-4-419", null, "05:37:00"],
      [HYEHWA, "05:38:30", "05:39:00"],
      ["S1-4-421", "05:41:00", "05:41:30"],
    ]);
    const histories = historiesOf(history("4507", { platformId: "S1-4-419", state: "arrived", at: at("05:01:01") }));
    const row: CountdownRow = { trainNo: "4507", platformId: HYEHWA, generatedAt: at("05:01:10"), remainingSec: 120 };

    // Act
    const { arrivals, divergences } = toStationArrivals(
      input({ platformId: HYEHWA, trains: [t4507], histories, countdownRows: [row], now: at("05:02:00") }),
    );

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("05:38:30"), "scheduled"]]);
    expect(divergences).toEqual([]);
  });

  it("serves first train 4004, not yet seen, at its scheduled 05:41:00 instead of a countdown to 05:12:30", () => {
    // Arrange
    const t4004 = trainWithStops("4004", "up", [
      ["S1-4-421", "05:38:30", "05:39:00"],
      [HYEHWA, "05:41:00", "05:41:30"],
      ["S1-4-419", "05:43:00", "05:43:30"],
    ]);
    const row: CountdownRow = { trainNo: "4004", platformId: HYEHWA, generatedAt: at("05:10:00"), remainingSec: 150 };

    // Act
    const { arrivals } = toStationArrivals(input({ platformId: HYEHWA, direction: "up", trains: [t4004], countdownRows: [row], now: at("05:11:00") }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("05:41:00"), "scheduled"]]);
  });

  it.each([
    ["121 s before", -121, "scheduled"],
    ["120 s before", -120, "live"],
    ["119 s before", -119, "live"],
    ["2,699 s after", 2699, "live"],
    ["2,700 s after", 2700, "live"],
    ["2,701 s after", 2701, "scheduled"],
  ])("reads a countdown to %s the scheduled arrival as live only inside −120…+2,700 s", (_label, offsetSec, source) => {
    // Arrange
    const generatedAt = at("21:00:00");
    const row: CountdownRow = { trainNo: "0493", platformId: SUNGKYUNKWAN, generatedAt, remainingSec: secondsUntil(plusSec(at("21:04:00"), offsetSec), generatedAt) };

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], countdownRows: [row], now: at("21:00:30") }));

    // Assert
    expect(arrivals.map((a) => a.source)).toEqual([source]);
  });
});

const secondsUntil = (later: Date, earlier: Date): number => (later.getTime() - earlier.getTime()) / 1000;

/** Train 0431 on the 2026-10-17 holiday table, southbound ahead of express 1913. */
const T0431 = trainWithStops("0431", "down", [
  ["KR-1-P151", "10:09:30", "10:10:00"],
  [UIWANG, "10:12:00", "10:12:30"],
  [SUNGKYUNKWAN, "10:15:30", "10:16:00"],
  [HWASEO, "10:18:30", "10:19:00"],
  ["KR-1-P155", "10:21:30", "10:22:00"],
]);

/** Express 1913 on the 2026-10-17 holiday table: its first stop the tables cover is Sungkyunkwan Univ. */
const T1913 = trainWithStops("1913", "down", [
  [SUNGKYUNKWAN, "10:25:00", "10:25:30"],
  ["KR-1-P155", "10:30:00", "10:30:30"],
]);

/** Train 0641 on the 2026-10-17 holiday table, calling at Dangjeong and Uiwang just after 1913 passes them. */
const T0641 = trainWithStops("0641", "down", [
  ["KR-1-P151", "10:22:30", "10:23:00"],
  [UIWANG, "10:25:00", "10:25:30"],
  [SUNGKYUNKWAN, "10:28:30", "10:29:00"],
]);

describe("toStationArrivals, for an express seen at stations it passes before its first stop", () => {
  it("serves southbound 1913, seen departing 의왕 at 10:23:21, 81 s late at 10:26:21 instead of borrowing 0431's 155 s", () => {
    // Arrange
    const histories = historiesOf(
      history("0431", { platformId: "KR-1-P155", state: "approaching", at: at("10:23:35") }),
      history("1913", { platformId: UIWANG, state: "departed", at: at("10:23:21") }),
    );

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0431, T1913, T0641], histories, now: at("10:23:37") }));

    // Assert
    // WHY: 0641 runs from Uiwang to Sungkyunkwan Univ. in 180 s, so 1913 is scheduled to pass Uiwang at 10:22:00; it arrived at 10:24:48.
    expect(arrivals.find((a) => a.trainNo === "1913")).toMatchObject({
      arrivalAt: at("10:26:21"),
      source: "estimated",
      position: { platformId: UIWANG, state: "departed" },
    });
  });

  it.each([
    ["1 s before it is scheduled to pass", "10:19:59", "10:24:30"],
    ["when it is scheduled to pass", "10:20:00", "10:24:30"],
    ["1 s after it is scheduled to pass", "10:20:01", "10:25:01"],
  ])("serves 1913, seen at 당정 at 10:19:30, later the longer it stands there, from %s", (_label, now, arrival) => {
    // Arrange
    const histories = historiesOf(history("1913", { platformId: "KR-1-P151", state: "arrived", at: at("10:19:30") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T1913, T0641], histories, now: at(now) }));

    // Assert
    // WHY: 0641's 120 s to Uiwang and 180 s on make 1913's pass of Dangjeong 10:20:00; its 30 s stand at Uiwang is not 1913's.
    expect(arrivals.find((a) => a.trainNo === "1913")?.arrivalAt).toEqual(at(arrival));
  });

  it("times 1913's pass of 의왕 from the train calling there nearest in time", () => {
    // Arrange
    const early = trainWithStops("0401", "down", [
      [UIWANG, "05:29:30", "05:30:00"],
      [SUNGKYUNKWAN, "05:34:00", "05:34:30"],
    ]);
    const histories = historiesOf(history("1913", { platformId: UIWANG, state: "departed", at: at("10:22:30") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [early, T1913, T0641], histories, now: at("10:22:40") }));

    // Assert
    expect(arrivals.find((a) => a.trainNo === "1913")?.arrivalAt).toEqual(at("10:25:30"));
  });
});

describe("toStationArrivals, rejecting a published countdown", () => {
  it.each([
    ["1 s before it is spent", "21:03:59", "live", []],
    ["when it is spent", "21:04:00", "scheduled", ["spent"]],
    ["1 s after it is spent", "21:04:01", "scheduled", ["spent"]],
  ])("counts 0493's 120 s, published at 21:02:00, %s only while some remain, and reports it spent after", (_label, now, source, reasons) => {
    // Arrange
    const row: CountdownRow = { trainNo: "0493", platformId: SUNGKYUNKWAN, generatedAt: at("21:02:00"), remainingSec: 120 };

    // Act
    const { arrivals, rejections } = toStationArrivals(input({ trains: [T0493], countdownRows: [row], now: at(now) }));

    // Assert
    expect(arrivals.map((a) => a.source)).toEqual([source]);
    expect(rejections.map((r) => r.reason)).toEqual(reasons);
  });

  it("reports first train 4507's countdown to 05:03:10, standing at its origin, as out of range against its scheduled 05:38:30", () => {
    // Arrange
    const t4507 = trainWithStops("4507", "down", [
      ["S1-4-419", null, "05:37:00"],
      [HYEHWA, "05:38:30", "05:39:00"],
    ]);
    const histories = historiesOf(history("4507", { platformId: "S1-4-419", state: "arrived", at: at("05:01:01") }));
    const row: CountdownRow = { trainNo: "4507", platformId: HYEHWA, generatedAt: at("05:01:10"), remainingSec: 120 };

    // Act
    const { rejections } = toStationArrivals(input({ platformId: HYEHWA, trains: [t4507], histories, countdownRows: [row], now: at("05:02:00") }));

    // Assert
    expect(rejections).toEqual([
      { trainNo: "4507", platformId: HYEHWA, reason: "out_of_range", liveArrivalAt: at("05:03:10"), estimatedArrivalAt: at("05:38:30") },
    ]);
  });

  it("reports 4555's countdown, arrived at 혜화 at 10:54:56, as at the station", () => {
    // Arrange
    const histories = historiesOf(history("4555", { platformId: HYEHWA, state: "arrived", at: at("10:54:56") }));
    const row: CountdownRow = { trainNo: "4555", platformId: HYEHWA, generatedAt: at("10:54:25"), remainingSec: 120 };

    // Act
    const { rejections } = toStationArrivals(input({ platformId: HYEHWA, trains: [T4555], histories, countdownRows: [row], now: at("10:55:12") }));

    // Assert
    expect(rejections).toEqual([
      { trainNo: "4555", platformId: HYEHWA, reason: "at_station", liveArrivalAt: at("10:56:25"), estimatedArrivalAt: at("10:54:56") },
    ]);
  });
});

const GEUMJEONG = "KR-1-P149";

/** Express 1935 on the 2026-10-17 holiday table: Geumjeong 16:17:30–16:18:30, Sungkyunkwan Univ. 16:27:00–16:28:00, Suwon. */
const T1935: ScheduledTrain = {
  ...trainWithStops("1935", "down", [
    [GEUMJEONG, "16:17:30", "16:18:30"],
    [SUNGKYUNKWAN, "16:27:00", "16:28:00"],
    ["KR-1-P155", "16:32:30", "16:33:30"],
  ]),
  express: true,
  destination: "신창",
};

/** Express 1937, the next one: Geumjeong 16:50:30–16:51:30, Sungkyunkwan Univ. 17:00:00–17:01:00. */
const T1937: ScheduledTrain = {
  ...trainWithStops("1937", "down", [
    [GEUMJEONG, "16:50:30", "16:51:30"],
    [SUNGKYUNKWAN, "17:00:00", "17:01:00"],
  ]),
  express: true,
  destination: "천안",
};

/** Local 0461, the train ahead of 1935: Uiwang 16:19:30–16:20:00, Sungkyunkwan Univ. 16:23:00–16:23:30, Hwaseo 16:26:00–16:26:30. */
const T0461 = trainWithStops("0461", "down", [
  [UIWANG, "16:19:30", "16:20:00"],
  [SUNGKYUNKWAN, "16:23:00", "16:23:30"],
  [HWASEO, "16:26:00", "16:26:30"],
]);

/** Local 0463, scheduled at Sungkyunkwan Univ. after 1935: Uiwang 16:35:00–16:35:30, Sungkyunkwan Univ. 16:38:30–16:39:00. */
const T0463 = trainWithStops("0463", "down", [
  [UIWANG, "16:35:00", "16:35:30"],
  [SUNGKYUNKWAN, "16:38:30", "16:39:00"],
]);

/** 0461 left Hwaseo 60 s late, so it lends 1935 a delay of 60 s. */
const H0461 = history("0461", { platformId: HWASEO, state: "departed", at: at("16:27:30") });

const listed1935 = (overrides: Partial<EstimateInput>): TrainArrival | undefined =>
  toStationArrivals(input({ trains: [T0461, T1935], histories: historiesOf(H0461), isTracked: true, ...overrides })).arrivals.find(
    (a) => a.trainNo === "1935",
  );

describe("toStationArrivals, for a tracked train not seen yet", () => {
  // 2026-10-17: no source reported express 1935 before it approached Sungkyunkwan Univ. at 16:38:53, 12.5 min late; it had
  // been dropped at 16:29, its scheduled departure plus 0461's 60 s, and its estimates were 633 to 766 s early.
  it.each([
    ["16:20:00", "16:28:00"],
    ["16:29:00", "16:28:00"],
    ["16:29:01", "16:37:31"],
    ["16:35:00", "16:43:30"],
  ])("serves unseen express 1935 at %s at %s: 0461's 60 s until it is overdue, then its 510 s run from 금정 away", (now, arrival) => {
    // Act
    const arrival1935 = listed1935({ now: at(now) });

    // Assert
    expect(arrival1935).toMatchObject({ arrivalAt: at(arrival), source: "estimated", position: null });
  });

  it("serves 1935 at its observed arrival once it is seen approaching 성균관대 at 16:38:53", () => {
    // Arrange
    const histories = historiesOf(H0461, history("1935", { platformId: SUNGKYUNKWAN, state: "approaching", at: at("16:38:53") }));

    // Act
    const arrival1935 = listed1935({ histories, now: at("16:39:00") });

    // Assert
    expect(arrival1935).toMatchObject({ arrivalAt: at("16:39:23"), source: "estimated", position: { platformId: SUNGKYUNKWAN, state: "approaching" } });
  });

  it.each([
    ["17:12:59", true],
    ["17:13:00", true],
    ["17:13:01", false],
  ])("lists 1935 at %s only up to its scheduled departure plus the largest delay, 2,700 s", (now, isListed) => {
    // Act
    const arrival1935 = listed1935({ now: at(now) });

    // Assert
    expect(arrival1935 !== undefined).toBe(isListed);
  });

  it("drops 1935 once express 1937, scheduled after it on its track, is seen at 성균관대", () => {
    // Arrange
    const histories = historiesOf(H0461, history("1937", { platformId: SUNGKYUNKWAN, state: "arrived", at: at("17:00:10") }));

    // Act
    const [unseen, overtaken] = [historiesOf(H0461), histories].map((h) => listed1935({ trains: [T0461, T1935, T1937], histories: h, now: at("17:00:20") }));

    // Assert
    expect([unseen !== undefined, overtaken]).toEqual([true, undefined]);
  });

  it("keeps 1935 listed when local 0463, scheduled after it, reaches 성균관대 first, as a local may overtake a late express", () => {
    // Arrange
    const histories = historiesOf(H0461, history("0463", { platformId: SUNGKYUNKWAN, state: "arrived", at: at("16:38:40") }));

    // Act
    const arrival1935 = listed1935({ trains: [T0461, T1935, T0463], histories, now: at("16:38:45") });

    // Assert
    expect(arrival1935?.arrivalAt).toEqual(at("16:47:15"));
  });

  it.each([
    ["16:30:00", 1],
    ["16:30:01", 0],
  ])("drops a train starting at 성균관대, with no row stop before it, at its scheduled departure: at %s it lists %d", (now, count) => {
    // Arrange
    const starting = trainWithStops("0418", "down", [
      [SUNGKYUNKWAN, null, "16:30:00"],
      [HWASEO, "16:32:30", "16:33:00"],
    ]);

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [starting], isTracked: true, now: at(now) }));

    // Assert
    expect(arrivals).toHaveLength(count);
  });
});

describe("toStationArrivals, for a tracked train seen at or past the station", () => {
  it("leaves out 0493, seen arrived at 화서 180 s before it is due there, though that delay is out of range", () => {
    // Arrange
    const histories = historiesOf(history("0493", { platformId: HWASEO, state: "arrived", at: at("21:04:30") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, isTracked: true, now: at("21:04:40") }));

    // Assert
    expect(arrivals).toEqual([]);
  });
});

describe("toStationArrivals, from the timetable alone", () => {
  it.each([
    ["16:29:00", true],
    ["16:29:01", false],
  ])("drops unseen 1935 at its scheduled departure plus 0461's 60 s, as before it was tracked: at %s listed %s", (now, isListed) => {
    // Act
    const arrival1935 = listed1935({ isTracked: false, now: at(now) });

    // Assert
    expect(arrival1935 !== undefined).toBe(isListed);
  });

  it("serves unseen 1935 at its scheduled arrival plus 0461's 60 s up to its departure plus that delay", () => {
    // Act
    const arrival1935 = listed1935({ isTracked: false, now: at("16:29:00") });

    // Assert
    expect(arrival1935).toMatchObject({ arrivalAt: at("16:28:00"), source: "estimated", position: null });
  });
});
