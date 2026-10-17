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
 */
import arrivalsFixture from "../../../../__tests__/nest/bus/fixtures/topis-jongro-arrivals.json";
import { jongroArrivalBus, noArrivalBus } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import type { JongroArrivalBus } from "../../cache/bus-cache.document";
import {
  isLastBus,
  toArrival,
  toArrivalCarNumber,
  toArrivalState,
  toCrowding,
  toMinutes,
  toPassengerCount,
  toStopsAway,
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

describe("toArrival", () => {
  it("serves a captured 곧 도착 with traTime 112 as arriving, no minutes, 0 stops away", () => {
    // Arrange
    const bus = capturedBus(arrivalsFixture.jongro08, "15", "1");

    // Act & Assert
    expect(toArrival(bus, SEAT_COUNT)).toEqual({
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
    expect(toArrival(bus, SEAT_COUNT)).toEqual({
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
    expect(toArrival(bus, SEAT_COUNT)).toEqual({
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
    expect(toArrival(jongroArrivalBus({ arrmsg: "결행", traTime: 300 }), SEAT_COUNT)).toMatchObject({
      state: "unknown",
      minutes: null,
      message: "결행",
    });
  });
});
