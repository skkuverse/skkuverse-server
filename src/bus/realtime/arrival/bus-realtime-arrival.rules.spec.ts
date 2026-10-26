/**
 * The arrival rules: how one bus of a TOPIS arrival row becomes the arrival a
 * station serves. Its state comes from its text and wins over its numbers;
 * minutes are whole, at least 1, from the travel time in seconds (the text's
 * time when that is 0) and only while running; stops away and the car number
 * need a vehicle; the last bus is the flag or a last-bus token; crowding is the
 * congestion code (type 4) or the passenger count against the route's seat
 * count (type 2), and the count is served for type 2 only.
 *
 * Captured rows come from __tests__/nest/bus/fixtures/topis-jongro-arrivals.json.
 * Texts TOPIS did not send during that capture (the last-bus token, ended,
 * turnaround wait, no information and the spacing variants) are the forms
 * other open-source parsers of `arrmsg` on GitHub report.
 *
 * A bus read on its route (the live route's reading) counts only the stations
 * it stops at between, leaving out the ones TOPIS names `…(미정차)` that
 * its `[N번째 전]` counts, and serves no crowding or count on a route whose
 * source reports no load: 7800's rows in topis-7800-arrivals.json, captured
 * 2026-10-24, carry rerdie_Div 2 with reride_Num 0 on every bus.
 */
import arrivals7800 from "../../../../__tests__/nest/bus/fixtures/topis-7800-arrivals.json";
import arrivalsFixture from "../../../../__tests__/nest/bus/fixtures/topis-jongro-arrivals.json";
import { jongroArrivalBus, noArrivalBus } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import type { JongroArrivalBus } from "../../cache/bus-cache.document";
import {
  isLastBus,
  toRealtimeArrival,
  toArrivalCarNumber,
  toArrivalState,
  toCrowding,
  toMinutes,
  toPassengerCount,
  toRouteArrival,
  toStoppingStopsAway,
  toStopsAway,
  toTravelSeconds,
} from "./bus-realtime-arrival.rules";

type FixtureResponse = (typeof arrivalsFixture)["jongro07Running"];

// The test's own reading of a captured row's bus slot, so the rules are fed exactly what TOPIS sent.
function capturedBus(response: FixtureResponse, staOrd: string, slot: "1" | "2"): JongroArrivalBus {
  const row = response.msgBody.itemList.find((r) => r.staOrd === staOrd) as Record<string, string>;
  return {
    traTime: Number(row[`traTime${slot}`]),
    sectOrd: Number(row[`sectOrd${slot}`]),
    staOrd: Number(row.staOrd),
    arrmsg: row[`arrmsg${slot}`]!,
    isLast: row[`isLast${slot}`] === "1",
    plainNo: row[`plainNo${slot}`]!,
    vehId: row[`vehId${slot}`]!,
    rerideDiv: Number(row[`rerdie_Div${slot}`]),
    rerideNum: Number(row[`reride_Num${slot}`]),
  };
}

const SEAT_COUNT = 18;

describe("toArrivalState", () => {
  it.each([
    ["운행종료", "ended"],
    ["운행중단", "ended"],
    ["막차운행종료", "ended"],
    ["[N5번째 전]운행종료", "ended"],
    ["출발대기", "waiting"],
    ["  출발대기 ", "waiting"],
    ["운행대기", "waiting"],
    ["회차대기", "waiting"],
    ["회차지", "waiting"],
    ["차고지", "waiting"],
    ["정보없음", "noInfo"],
    ["도착정보 없음", "noInfo"],
    ["곧 도착", "arriving"],
    ["곧 도착[1번째 전]", "arriving"],
    ["진입", "arriving"],
    ["잠시후", "arriving"],
    ["3분12초후[2번째 전]", "running"],
    ["2분후[2번째 전]", "running"],
    ["2분후 [2번째 전]", "running"],
    ["12분후", "running"],
    ["20초후[1번째 전]", "running"],
    ["15분23초후[0번째 전]", "running"],
    ["[막차]3분10초후[2번째 전]", "running"],
    ["[막차] 5분후[3번째 전]", "running"],
    ["5분후[3번째 전][막차]", "running"],
    ["막차 13분10초후[6번째 전]", "running"],
    ["결행", "unknown"],
    ["", "unknown"],
    ["후", "unknown"],
    ["[2번째 전]", "unknown"],
  ])("%j → %s", (arrmsg, expected) => {
    // Act & Assert
    expect(toArrivalState(arrmsg)).toBe(expected);
  });
});

// WHY: arrmsg is upstream text read on every request; a backtracking pattern over a crafted or broken
// 100k-character message would hold the event loop for seconds (security scan F8, CWE-1333).
describe("reading a pathological 100k-character arrival text", () => {
  const MAX_ELAPSED_MS = 1_000;
  const PATHOLOGICAL_LENGTH = 100_000;

  it.each([
    ["unclosed brackets", "[".repeat(PATHOLOGICAL_LENGTH)],
    ["a minutes token followed by whitespace", `1분${" ".repeat(PATHOLOGICAL_LENGTH)}`],
    ["a seconds-alone digit followed by whitespace", `1${" ".repeat(PATHOLOGICAL_LENGTH)}`],
    ["a digit run", "1".repeat(PATHOLOGICAL_LENGTH)],
  ])("returns quickly on %s", (_label, arrmsg) => {
    // Arrange
    const bus = jongroArrivalBus({ traTime: 0, arrmsg });
    const startedAt = performance.now();

    // Act
    const state = toArrivalState(arrmsg);
    const seconds = toTravelSeconds(bus);

    // Assert
    expect(performance.now() - startedAt).toBeLessThan(MAX_ELAPSED_MS);
    expect([state, seconds]).toEqual(["unknown", null]);
  });
});

describe("isLastBus", () => {
  it.each([
    [true, "3분후[2번째 전]", true],
    [false, "5분후[3번째 전][막차]", true],
    [false, "[막차]3분10초후[2번째 전]", true],
    [false, "3분후[2번째 전]", false],
  ])("flag %s with %j → %s", (isLast, arrmsg, expected) => {
    // Act & Assert
    expect(isLastBus(jongroArrivalBus({ isLast, arrmsg }))).toBe(expected);
  });
});

// WHY: community parsers flag the last bus on the last-bus word anywhere in the text, so the bare prefix TOPIS
// also sends counts, while the ended-last-bus phrase still reads as ended (owner decision after Stage 1).
describe("isLastBus on 막차 anywhere in the text", () => {
  it.each([
    [false, "막차 13분10초후[6번째 전]", true],
    [false, "막차운행종료", true],
    [false, "곧 도착", false],
  ])("flag %s with %j → %s", (isLast, arrmsg, expected) => {
    // Act & Assert
    expect(isLastBus(jongroArrivalBus({ isLast, arrmsg }))).toBe(expected);
  });

  it("keeps 막차운행종료 as ended", () => {
    // Act & Assert
    expect(toArrivalState("막차운행종료")).toBe("ended");
  });
});

// WHY: the live route serves an instant, TOPIS's mkTm plus these seconds, never rounded (ADR 0019, D1).
describe("toTravelSeconds", () => {
  it.each([
    [192, "3분12초후[2번째 전]", 192],
    [112, "곧 도착", 112],
    [0, "1분40초후[1번째 전]", 100],
    [0, "[막차]12분후", 720],
    [0, "20초후[1번째 전]", 20],
    [0, "곧 도착", null],
    [0, "출발대기", null],
    [0, "결행", null],
  ])("traTime %i and %j → %s", (traTime, arrmsg, expected) => {
    // Act & Assert
    expect(toTravelSeconds(jongroArrivalBus({ traTime, arrmsg }))).toBe(expected);
  });
});

describe("toMinutes", () => {
  it.each([
    [192, "3분12초후[2번째 전]", 3],
    [20, "20초후[1번째 전]", 1],
    [29, "29초후[1번째 전]", 1],
    [89, "1분29초후[1번째 전]", 1],
    [90, "1분30초후[1번째 전]", 2],
    [91, "1분31초후[1번째 전]", 2],
    [94, "2분후[2번째 전]", 2],
    [176, "2분후[2번째 전]", 3],
  ])("a running bus with traTime %i and %j → %i", (traTime, arrmsg, expected) => {
    // Act & Assert
    expect(toMinutes(jongroArrivalBus({ traTime, arrmsg }))).toBe(expected);
  });

  it.each([
    ["4분후[2번째 전]", 4],
    ["1분40초후[1번째 전]", 2],
    ["20초후[1번째 전]", 1],
    ["[막차]12분후", 12],
  ])("a running bus with traTime 0 and %j reads the text → %i", (arrmsg, expected) => {
    // Act & Assert
    expect(toMinutes(jongroArrivalBus({ traTime: 0, arrmsg }))).toBe(expected);
  });

  it.each([
    [95, "곧 도착"],
    [240, "출발대기"],
    [300, "운행종료"],
    [120, "정보없음"],
    [60, "결행"],
  ])("traTime %i with %j → null, the state wins", (traTime, arrmsg) => {
    // Act & Assert
    expect(toMinutes(jongroArrivalBus({ traTime, arrmsg }))).toBeNull();
  });

  it("reads 2분후[2번째 전] with a captured traTime of 94 as 2 minutes and of 167 as 3", () => {
    // Arrange
    const [at94, at167] = [capturedBus(arrivalsFixture.jongro07Running, "5", "1"), capturedBus(arrivalsFixture.jongro07Running, "22", "1")];

    // Act & Assert
    expect([at94.arrmsg, at94.traTime, toMinutes(at94)]).toEqual(["2분후[2번째 전]", 94, 2]);
    expect([at167.arrmsg, at167.traTime, toMinutes(at167)]).toEqual(["2분후[2번째 전]", 167, 3]);
  });
});

describe("toStopsAway", () => {
  it("is the station's ord minus the bus's section ord", () => {
    // Act & Assert
    expect(toStopsAway(jongroArrivalBus({ staOrd: 12, sectOrd: 10 }))).toBe(2);
  });

  it("matches the [N번째 전] of a captured row", () => {
    // Arrange
    const bus = capturedBus(arrivalsFixture.jongro07Running, "16", "2");

    // Act & Assert
    expect([bus.arrmsg, toStopsAway(bus)]).toEqual(["12분41초후[13번째 전]", 13]);
  });

  it.each([["0"], [""]])("is null without a vehicle (vehId %j)", (vehId) => {
    // Act & Assert
    expect(toStopsAway(noArrivalBus({ vehId, staOrd: 12 }))).toBeNull();
  });
});

describe("toArrivalCarNumber", () => {
  it("is the plate's last four digits", () => {
    // Act & Assert
    expect(toArrivalCarNumber(jongroArrivalBus({ plainNo: "서울74사1234" }))).toBe("1234");
  });

  it("is null without a vehicle", () => {
    // Act & Assert
    expect(toArrivalCarNumber(capturedBus(arrivalsFixture.jongro07Waiting, "2", "2"))).toBeNull();
  });
});

describe("toCrowding", () => {
  it.each([
    [2, 17, "relaxed"],
    [2, 18, "relaxed"],
    [2, 19, "normal"],
    [2, 27, "normal"],
    [2, 28, "crowded"],
    [2, 0, "relaxed"],
    [2, null, null],
    [4, 2, null],
    [4, 3, "relaxed"],
    [4, 4, "normal"],
    [4, 5, "crowded"],
    [4, 6, null],
    [0, 9, null],
    [null, 9, null],
  ])("type %j with %j on 18 seats → %j", (rerideDiv, rerideNum, expected) => {
    // Act & Assert
    expect(toCrowding(rerideDiv, rerideNum, SEAT_COUNT)).toBe(expected);
  });

  it("scales with the seat count", () => {
    // Act & Assert
    expect([toCrowding(2, 30, 20), toCrowding(2, 31, 20)]).toEqual(["normal", "crowded"]);
  });
});

describe("toPassengerCount", () => {
  it.each([
    [2, 9, 9],
    [2, 0, 0],
    [4, 5, null],
    [0, 9, null],
    [null, 9, null],
  ])("type %j with %j → %j", (rerideDiv, rerideNum, expected) => {
    // Act & Assert
    expect(toPassengerCount(jongroArrivalBus({ rerideDiv, rerideNum }))).toBe(expected);
  });
});

describe("toRealtimeArrival", () => {
  it("serves a captured 곧 도착 with traTime 112 as arriving, no minutes, 0 stops away", () => {
    // Arrange
    const bus = capturedBus(arrivalsFixture.jongro08, "15", "1");

    // Act & Assert
    expect(toRealtimeArrival(bus, SEAT_COUNT)).toEqual({
      minutes: null,
      stopsAway: 0,
      state: "arriving",
      isLastBus: false,
      carNumber: "5504",
      crowding: "relaxed",
      passengerCount: 6,
      message: "곧 도착",
    });
  });

  it("serves a captured 출발대기 bus idling at 학생회관 with a traTime as waiting, no minutes", () => {
    // Arrange
    const bus = capturedBus(arrivalsFixture.jongro07Waiting, "7", "1");

    // Act & Assert
    expect([bus.traTime, bus.sectOrd]).toEqual([484, 2]);
    expect(toRealtimeArrival(bus, SEAT_COUNT)).toEqual({
      minutes: null,
      stopsAway: 5,
      state: "waiting",
      isLastBus: false,
      carNumber: "5536",
      crowding: null,
      passengerCount: null,
      message: "출발대기",
    });
  });

  it("serves a captured running bus with whole minutes and its passengers", () => {
    // Arrange
    const bus = capturedBus(arrivalsFixture.jongro07Waiting, "12", "2");

    // Act & Assert
    expect(toRealtimeArrival(bus, SEAT_COUNT)).toEqual({
      minutes: 2,
      stopsAway: 1,
      state: "running",
      isLastBus: false,
      carNumber: "5538",
      crowding: "relaxed",
      passengerCount: 7,
      message: "2분19초후[1번째 전]",
    });
  });

  it("serves a phrase no pattern matches as unknown, carrying the phrase", () => {
    // Act & Assert
    expect(toRealtimeArrival(jongroArrivalBus({ arrmsg: "결행", traTime: 300 }), SEAT_COUNT)).toMatchObject({
      state: "unknown",
      minutes: null,
      message: "결행",
    });
  });
});

// 7800's virtual stations in the capture, the `…(미정차)` rows, held apart from the rule that recognizes them by name.
const PASS_THROUGH_7800: ReadonlySet<number> = new Set([28, 29, 30, 32, 33, 34, 35, 36, 40, 42, 43, 45, 46, 47, 48, 49, 51, 52, 53]);
const NO_PASS_THROUGH: ReadonlySet<number> = new Set();

// The test's own reading of a captured 7800 row's bus slot, as BusRealtimeJongroClient reads it.
function captured7800(staOrd: number, slot: "1" | "2"): JongroArrivalBus {
  const row = arrivals7800.msgBody.itemList.find((candidate) => Number(candidate.staOrd) === staOrd) as Record<string, string>;
  return {
    traTime: Number(row[`traTime${slot}`]),
    sectOrd: Number(row[`sectOrd${slot}`]),
    staOrd,
    arrmsg: row[`arrmsg${slot}`]!,
    isLast: row[`isLast${slot}`] === "1",
    plainNo: row[`plainNo${slot}`]!,
    vehId: row[`vehId${slot}`]!,
    rerideDiv: Number(row[`rerdie_Div${slot}`]),
    rerideNum: Number(row[`reride_Num${slot}`]),
  };
}

describe("toStoppingStopsAway", () => {
  it.each([
    [31, "1", "10분25초후[5번째 전]", 2],
    [31, "2", "17분57초후[8번째 전]", 5],
    [37, "1", "2분51초후[1번째 전]", 0],
    [37, "2", "12분18초후[5번째 전]", 0],
    [41, "1", "9분53초후[3번째 전]", 2],
    [28, "1", "6분50초후[2번째 전]", 2],
    [26, "1", "2분34초후[0번째 전]", 0],
    [25, "2", "19분57초후[9번째 전]", 9],
  ] as const)("serves 7800's staOrd %i slot %s (%s) %i stopping stations between", (staOrd, slot, arrmsg, expected) => {
    // Arrange
    const bus = captured7800(staOrd, slot);

    // Act & Assert
    expect([bus.arrmsg, toStoppingStopsAway(bus, PASS_THROUGH_7800)]).toEqual([arrmsg, expected]);
  });

  it("is null at 7800's origin, where TOPIS names no vehicle for either 출발대기", () => {
    // Act & Assert
    expect(["1", "2"].map((slot) => toStoppingStopsAway(captured7800(1, slot as "1" | "2"), PASS_THROUGH_7800))).toEqual([null, null]);
  });

  it("is TOPIS's own count on a route that passes through no station", () => {
    // Arrange
    const bus = capturedBus(arrivalsFixture.jongro07Running, "16", "2");

    // Act & Assert
    expect(toStoppingStopsAway(bus, NO_PASS_THROUGH)).toBe(toStopsAway(bus));
  });
});

describe("toRouteArrival", () => {
  const ROUTE_7800 = { seatCount: 45, capabilities: { occupancy: false }, passThroughOrds: PASS_THROUGH_7800 };

  it("serves a captured 7800 bus with no crowding or count, its source reporting no load", () => {
    // Arrange
    const bus = captured7800(24, "1");

    // Act & Assert
    expect(toRouteArrival(bus, ROUTE_7800)).toEqual({
      minutes: 3,
      stopsAway: 1,
      state: "running",
      isLastBus: false,
      carNumber: "1710",
      crowding: null,
      passengerCount: null,
      message: "2분41초후[1번째 전]",
    });
  });

  it("serves the same bus's placeholder load on a route whose source reports one, so the capability alone gates it", () => {
    // Arrange
    const bus = captured7800(24, "1");

    // Act & Assert
    expect(toRouteArrival(bus, { ...ROUTE_7800, capabilities: { occupancy: true } })).toMatchObject({ crowding: "relaxed", passengerCount: 0 });
  });

  it("counts a bus past 7800's virtual stations by the stations it stops at", () => {
    // Act & Assert
    expect(toRouteArrival(captured7800(31, "1"), ROUTE_7800).stopsAway).toBe(2);
  });

  it("reads 7800's [0번째 전] as running and its origin's 출발대기 as waiting", () => {
    // Act & Assert
    expect([toRouteArrival(captured7800(26, "1"), ROUTE_7800).state, toRouteArrival(captured7800(1, "1"), ROUTE_7800).state]).toEqual(["running", "waiting"]);
  });

  it("serves a Jongro bus exactly as toRealtimeArrival does", () => {
    // Arrange
    const bus = capturedBus(arrivalsFixture.jongro07Waiting, "12", "2");

    // Act & Assert
    expect(toRouteArrival(bus, { seatCount: SEAT_COUNT, capabilities: { occupancy: true }, passThroughOrds: NO_PASS_THROUGH })).toEqual(toRealtimeArrival(bus, SEAT_COUNT));
  });
});
