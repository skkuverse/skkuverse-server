/**
 * The HSSC ETA engine (ADR 0018): what one fresh bus, anchored on its latest stop event,
 * means for one stop of the loop. A bus ahead of the stop in its lap is en route, expected at an instant summed from
 * the measured dwell and travel medians, each overdue part counting 0; a bus at the stop is arriving; a bus whose path
 * crosses the turnaround layover (seq 5) it has not left (laying over there, or past the stop in this lap) is waiting to depart,
 * with no instant, except that the turnaround itself is reached by every bus heading to it. Stops away counts the stops the
 * bus reaches before this one, plus one, skipping the two rotary passes (seq 1 and 10; ADR 0019, D4): 0 at the stop,
 * a lap (9) for a bus that has left it. A stop's ETAs come nearest first, a bus laying over at the turnaround first there.
 * A bus at a stop leaves it after the rest of its dwell, and its lap times run stop by stop to the turnaround.
 *
 * The seconds below are the medians of `SEGMENTS_BY_SEQ` (ADR 0018, D3), as seq: dwell, travel to the next:
 * 0: 174, 30; 1: 12, 70; 2: 63, 28; 3: 30, 57; 4: 33, 30; 5: layover, 21; 6: 24, 54; 7: 24, 111; 8: 24, 94; 9: 21, 24;
 * 10: 12, 81.
 */
import { isDepartureEvent, isHsscStop, toHsscEta, toLapTimes, toStopEtas, toStopsAway } from "./bus-realtime-hssc-eta.rules";
import type { HsscBusAnchor, HsscEta } from "./bus-realtime-hssc-eta.types";

const NOW = new Date("2026-10-20T01:00:00Z");
const secondsAgo = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);
const secondsAhead = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

function anchor(seq: number, isDeparted: boolean, sinceSecondsAgo = 0, vehicleId = "32149"): HsscBusAnchor {
  return { vehicleId, seq, isDeparted, since: secondsAgo(sinceSecondsAgo), observedAt: secondsAgo(sinceSecondsAgo) };
}

const atStop = (seq: number, sinceSecondsAgo = 0) => anchor(seq, false, sinceSecondsAgo);
const departed = (seq: number, sinceSecondsAgo = 0) => anchor(seq, true, sinceSecondsAgo);

function arrivalSeconds(eta: HsscEta): number | null {
  return eta.status === "enRoute" ? (eta.arrivesAt.getTime() - NOW.getTime()) / 1000 : null;
}

describe("toHsscEta", () => {
  it.each([
    ["at 혜화역 for 100 s, to 사거리: 74 + 30 + 12 + 70", atStop(0, 100), 2, 186],
    ["left 혜화역 10 s ago, to 사거리: 20 + 12 + 70", departed(0, 10), 2, 102],
    ["left 우체국 60 s ago, to 혜화역: the overdue 24 counts 0, then 12 + 81", departed(9, 60), 0, 93],
    ["at 혜화역 for 300 s, to the rotary: the overdue dwell counts 0, then 30", atStop(0, 300), 1, 30],
    ["left 600주년(하교) 40 s ago, to 문묘입구(하교): 14", departed(6, 40), 7, 14],
    ["left 농구장 10 s ago, to 600주년(하교): 11", departed(5, 10), 6, 11],
    ["entered 600주년(등교) just now, to 농구장: 33 + 30", atStop(4), 5, 63],
    ["left 600주년(등교) 10 s ago, to 농구장: 20", departed(4, 10), 5, 20],
    ["entered the rotary (seq 10) just now, to 농구장: 93 + 204 + 82 + 91 + 87 + 63", atStop(10), 5, 620],
    ["left 농구장 just now, to 농구장: the whole lap, 21 + 996 (seq 6 to 4)", departed(5), 5, 1017],
  ])("a bus %s → en route, %i s", (_case, bus, targetSeq, seconds) => {
    // Act
    const eta = toHsscEta(bus, targetSeq, NOW);

    // Assert
    expect(eta.status).toBe("enRoute");
    expect(arrivalSeconds(eta)).toBe(seconds);
  });

  it("counts no time elapsed for an event stamped after now", () => {
    // Arrange
    const bus = { ...departed(0), since: secondsAhead(20), observedAt: secondsAhead(20) };

    // Act & Assert
    expect(arrivalSeconds(toHsscEta(bus, 2, NOW))).toBe(30 + 12 + 70);
  });

  it("serves a bus at the stop as arriving, leaving after the rest of its dwell (174 s at 혜화역)", () => {
    // Act & Assert
    expect(toHsscEta(atStop(0, 100), 0, NOW)).toEqual({ status: "arriving", vehicleId: "32149", stopsAway: 0, observedAt: secondsAgo(100), departsAt: secondsAhead(74) });
  });

  it("serves a bus overdue at the stop as leaving now", () => {
    // Act & Assert
    expect(toHsscEta(atStop(0, 300), 0, NOW)).toMatchObject({ status: "arriving", departsAt: NOW });
  });

  it.each([
    ["laying over at 농구장, to 600주년(하교)", atStop(5, 300), 6, 1],
    ["laying over at 농구장, to 혜화역", atStop(5, 300), 0, 5],
    ["laying over at 농구장, to 농구장 itself", atStop(5, 300), 5, 0],
    ["just left 혜화역, to 혜화역", departed(0), 0, 9],
    ["at 혜화역, to 600주년(하교) behind it in the lap", atStop(0), 6, 5],
    ["at 600주년(등교), to 600주년(하교) at the lap's start", atStop(4), 6, 2],
  ])("a bus %s → waiting to depart, %i stops away", (_case, bus, targetSeq, stopsAway) => {
    // Act
    const eta = toHsscEta(bus, targetSeq, NOW);

    // Assert
    expect(eta).toEqual({ status: "waitingToDepart", vehicleId: "32149", stopsAway, observedAt: bus.observedAt });
  });

  it("carries the bus's vehicle id, its stops away and when its anchor event was observed", () => {
    // Arrange
    const bus = { ...departed(0, 10), vehicleId: "32150", observedAt: secondsAgo(25) };

    // Act & Assert
    expect(toHsscEta(bus, 3, NOW)).toEqual({ status: "enRoute", vehicleId: "32150", stopsAway: 2, observedAt: secondsAgo(25), arrivesAt: secondsAhead(20 + 82 + 91) });
  });
});

describe("toStopsAway", () => {
  it.each([
    [atStop(0), 0, 0],
    [departed(0), 0, 9],
    [atStop(0), 2, 1],
    [departed(4), 5, 1],
    [departed(5), 4, 8],
    [atStop(10), 0, 1],
    [departed(9), 0, 1],
    [atStop(2), 6, 4],
  ])("bus %j to seq %i → %i", (bus, targetSeq, expected) => {
    // Act & Assert
    expect(toStopsAway(bus, targetSeq)).toBe(expected);
  });
});

describe("toStopEtas", () => {
  it("lists a stop's buses nearest first: arriving, en route by instant, then waiting by stops away", () => {
    // Arrange
    const buses = [
      { ...atStop(5, 60), vehicleId: "layover" },
      { ...departed(9, 0), vehicleId: "far" },
      { ...atStop(4, 30), vehicleId: "past" },
      { ...departed(2, 0), vehicleId: "near" },
      { ...atStop(3, 10), vehicleId: "here" },
    ];

    // Act
    const etas = toStopEtas(buses, 3, NOW);

    // Assert
    expect(etas.map((eta) => [eta.vehicleId, eta.status, eta.stopsAway])).toEqual([
      ["here", "arriving", 0],
      ["near", "enRoute", 1],
      ["far", "enRoute", 3],
      ["layover", "waitingToDepart", 7],
      ["past", "waitingToDepart", 8],
    ]);
  });

  it("lists the bus laying over at the turnaround first there, the one a rider boards", () => {
    // Arrange
    const buses = [{ ...departed(4, 0), vehicleId: "coming" }, { ...atStop(5, 120), vehicleId: "boarding" }];

    // Act
    const etas = toStopEtas(buses, 5, NOW);

    // Assert
    expect(etas.map((eta) => [eta.vehicleId, eta.status, eta.stopsAway])).toEqual([
      ["boarding", "waitingToDepart", 0],
      ["coming", "enRoute", 1],
    ]);
  });

  it("lists nothing when no bus is fresh", () => {
    // Act & Assert
    expect(toStopEtas([], 0, NOW)).toEqual([]);
  });
});

describe("toLapTimes", () => {
  it("runs from the next position to the turnaround: each arrival, then its departure after the dwell", () => {
    // Act
    const times = toLapTimes(departed(9, 10), NOW);

    // Assert
    const at = (seconds: number) => secondsAhead(seconds);
    expect(times).toEqual([
      { seq: 10, arrivesAt: at(14), departsAt: at(26) },
      { seq: 0, arrivesAt: at(107), departsAt: at(281) },
      { seq: 1, arrivesAt: at(311), departsAt: at(323) },
      { seq: 2, arrivesAt: at(393), departsAt: at(456) },
      { seq: 3, arrivesAt: at(484), departsAt: at(514) },
      { seq: 4, arrivesAt: at(571), departsAt: at(604) },
      { seq: 5, arrivesAt: at(634), departsAt: null },
    ]);
  });

  it("starts after the rest of a stopped bus's dwell", () => {
    // Act
    const [next] = toLapTimes(atStop(4, 13), NOW);

    // Assert
    expect(next).toEqual({ seq: 5, arrivesAt: secondsAhead(20 + 30), departsAt: null });
  });

  it("agrees with the en-route instant at each stop", () => {
    // Arrange
    const bus = departed(6, 30);

    // Act
    const times = toLapTimes(bus, NOW);

    // Assert
    for (const { seq, arrivesAt } of times) expect(toHsscEta(bus, seq, NOW)).toMatchObject({ status: "enRoute", arrivesAt });
  });

  it("is empty for a bus laying over, whose departure cannot be predicted", () => {
    // Act & Assert
    expect(toLapTimes(atStop(5, 60), NOW)).toEqual([]);
  });
});

describe("isHsscStop", () => {
  it.each([
    [0, true],
    [1, false],
    [2, true],
    [5, true],
    [9, true],
    [10, false],
    [11, false],
    [-1, false],
  ])("seq %i → %s", (seq, expected) => {
    // Act & Assert
    expect(isHsscStop(seq)).toBe(expected);
  });
});

describe("isDepartureEvent", () => {
  it.each([
    ["LEFT", true],
    ["LEFT_LAST", true],
    ["ENTERED", false],
    ["EMERGENCY", false],
    ["", false],
  ])("%j → %s", (inout, expected) => {
    // Act & Assert
    expect(isDepartureEvent(inout)).toBe(expected);
  });
});
