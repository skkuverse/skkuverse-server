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
import type { EstimateInput } from "./subway-estimate.types";

const UIWANG = "KR-1-P152";
const SUNGKYUNKWAN = "KR-1-0153";
const HWASEO = "KR-1-P154";

const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);
const plusSec = (instant: Date, seconds: number): Date => new Date(instant.getTime() + seconds * 1000);

/** A train calling at Uiwang, Sungkyunkwan Univ. and Hwaseo in its direction's order, 210 s apart, standing 30 s at each. */
function train(trainNo: string, direction: SubwayDirection, sungkyunkwanArrival: string): ScheduledTrain {
  const arrival = at(sungkyunkwanArrival);
  const stop = (stationId: string, offsetSec: number) => ({
    stationId,
    arrivalAt: plusSec(arrival, offsetSec),
    departureAt: plusSec(arrival, offsetSec + 30),
  });
  const stations = direction === "down" ? [UIWANG, SUNGKYUNKWAN, HWASEO] : [HWASEO, SUNGKYUNKWAN, UIWANG];
  return {
    trainNo,
    direction,
    destination: direction === "down" ? "서동탄" : "광운대",
    express: false,
    stops: stations.map((stationId, index) => stop(stationId, (index - 1) * 210)),
  };
}

function history(trainNo: string, latest: Omit<TrainProgress, "ordinal">, direction: SubwayDirection = "down"): TrainHistory {
  return { trainNo, direction, destination: direction === "down" ? "서동탄" : "광운대", latest: { ...latest, ordinal: 0 }, lastSeenAt: latest.at };
}

function input(overrides: Partial<EstimateInput>): EstimateInput {
  return { stationId: SUNGKYUNKWAN, direction: "down", trains: [], histories: new Map(), countdownRows: [], now: at("21:02:10"), ...overrides };
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
    expect(toDelaySec(T0493, { stationId: UIWANG, state, at: at(kst), ordinal: 0 }, at(kst))).toBe(delaySec);
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
    expect(toDelaySec(T0493, { stationId: UIWANG, state: "departed", at: departedAt, ordinal: 0 }, departedAt)).toBe(delaySec);
  });

  it.each([
    ["at its scheduled departure", "21:01:00", 0],
    ["1 s past its scheduled departure", "21:01:01", 1],
    ["60 s past its scheduled departure", "21:02:00", 60],
  ])("counts a train that arrived on time and still stands %s as that late", (_label, now, delaySec) => {
    // Act & Assert
    expect(toDelaySec(T0493, { stationId: UIWANG, state: "arrived", at: at("21:00:30"), ordinal: 0 }, at(now))).toBe(delaySec);
  });

  it("keeps the larger observed delay while a train stands", () => {
    // Act & Assert
    expect(toDelaySec(T0493, { stationId: UIWANG, state: "arrived", at: at("21:02:00"), ordinal: 0 }, at("21:02:10"))).toBe(90);
  });

  it("has no delay at a station the train's row does not call at", () => {
    // Act & Assert
    expect(toDelaySec(T0493, { stationId: "KR-1-P151", state: "arrived", at: at("21:00:00"), ordinal: 0 }, at("21:00:00"))).toBeNull();
  });
});

describe("toStationArrivals", () => {
  it("serves southbound 0493, 90 s late arriving at 의왕, at 성균관대 at 21:05:30 as estimated", () => {
    // Arrange
    const histories = historiesOf(history("0493", { stationId: UIWANG, state: "arrived", at: at("21:02:00") }));

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
        position: { stationId: UIWANG, state: "arrived" },
      },
    ]);
  });

  it("serves a train standing at 의왕 past its departure later the longer it stands", () => {
    // Arrange
    const histories = historiesOf(history("0493", { stationId: UIWANG, state: "arrived", at: at("21:00:30") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("21:02:00") }));

    // Assert
    expect(arrivals[0]?.arrivalAt).toEqual(at("21:05:00"));
  });

  it("lends the delay of the train ahead, 60 s late, to the next northbound train still at its origin", () => {
    // Arrange
    const ahead = train("0492", "up", "21:04:00");
    const next = train("0494", "up", "21:14:00");
    const histories = historiesOf(history("0492", { stationId: HWASEO, state: "departed", at: at("21:02:00") }, "up"));

    // Act
    const { arrivals } = toStationArrivals(input({ direction: "up", trains: [next, ahead], histories, now: at("21:02:00") }));

    // Assert
    expect(arrivals.map((a) => [a.trainNo, a.arrivalAt, a.source, a.position])).toEqual([
      ["0492", at("21:05:00"), "estimated", { stationId: HWASEO, state: "departed" }],
      ["0494", at("21:15:00"), "estimated", null],
    ]);
  });

  it("lends the delay of the nearest observed train ahead, not of one further ahead", () => {
    // Arrange
    const trains = [train("0491", "down", "20:54:00"), T0493, train("0495", "down", "21:14:00")];
    const histories = historiesOf(
      history("0491", { stationId: HWASEO, state: "departed", at: at("20:58:30") }),
      history("0493", { stationId: UIWANG, state: "arrived", at: at("21:02:00") }),
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
    const histories = historiesOf(history("0493", { stationId: UIWANG, state: "arrived", at: at("21:02:00") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493, train("0495", "down", kst)], histories }));

    // Assert
    expect(arrivals.find((a) => a.trainNo === "0495")?.source).toBe(source);
  });

  it("serves a train whose delay is out of range like an unobserved one, a likely train-number mismatch", () => {
    // Arrange
    const histories = historiesOf(history("0493", { stationId: UIWANG, state: "arrived", at: at("20:58:29") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("20:58:30") }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source, a.position])).toEqual([[at("21:04:00"), "scheduled", null]]);
  });

  it.each([
    ["departed 성균관대", SUNGKYUNKWAN, "departed"],
    ["arrived at 화서", HWASEO, "arrived"],
  ] as const)("leaves out a train observed to have %s", (_label, stationId, state) => {
    // Arrange
    const histories = historiesOf(history("0493", { stationId, state, at: at("21:04:30") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("21:04:40") }));

    // Assert
    expect(arrivals).toEqual([]);
  });

  it("lists a train standing at 성균관대 until it is seen departing", () => {
    // Arrange
    const histories = historiesOf(history("0493", { stationId: SUNGKYUNKWAN, state: "arrived", at: at("21:04:00") }));

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], histories, now: at("21:05:00") }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("21:04:30"), "estimated"]]);
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
    const row: CountdownRow = { trainNo: "0493", stationId: SUNGKYUNKWAN, generatedAt: plusSec(now, -40), remainingSec: 150 };

    // Act
    const { arrivals } = toStationArrivals(input({ trains: [T0493], countdownRows: [row], now }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[plusSec(now, 110), "live"]]);
  });

  it("computes a zero countdown as a train without one, never as arriving now", () => {
    // Arrange
    const row: CountdownRow = { trainNo: "0493", stationId: SUNGKYUNKWAN, generatedAt: at("21:02:00"), remainingSec: 0 };

    // Act
    const { arrivals, divergences } = toStationArrivals(input({ trains: [T0493], countdownRows: [row] }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[at("21:04:00"), "scheduled"]]);
    expect(divergences).toEqual([]);
  });

  it("reads a countdown only from a row for the station and the train", () => {
    // Arrange
    const rows: CountdownRow[] = [
      { trainNo: "0493", stationId: UIWANG, generatedAt: at("21:02:00"), remainingSec: 30 },
      { trainNo: "0495", stationId: SUNGKYUNKWAN, generatedAt: at("21:02:00"), remainingSec: 30 },
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
    const row: CountdownRow = { trainNo: "0493", stationId: SUNGKYUNKWAN, generatedAt, remainingSec: 120 + gapSec };

    // Act
    const { arrivals, divergences } = toStationArrivals(input({ trains: [T0493], countdownRows: [row] }));

    // Assert
    expect(arrivals.map((a) => [a.arrivalAt, a.source])).toEqual([[plusSec(generatedAt, 120 + gapSec), "live"]]);
    expect(divergences).toEqual(
      isDivergent
        ? [{ trainNo: "0493", stationId: SUNGKYUNKWAN, liveArrivalAt: plusSec(generatedAt, 120 + gapSec), estimatedArrivalAt: at("21:04:00"), divergenceSec: gapSec }]
        : [],
    );
  });
});
