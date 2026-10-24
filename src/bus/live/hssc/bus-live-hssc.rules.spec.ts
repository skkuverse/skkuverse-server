/**
 * An HSSC bus in the live shape (ADR 0019, D1, D6, D7, D14): an engine ETA is an estimated stop call (standing at the
 * stop as arriving with no departure instant, en route with when it comes, or waiting behind the layover), a bus laying over waits to
 * depart, and a moving bus's trajectory runs through each stop's arrival and departure to the turnaround, s passing
 * the last index on the way back to station 0.
 */
import type { HsscLiveBus } from "./bus-live-hssc.types";
import { toHsscCall, toHsscPositionStatus, toHsscTrajectory } from "./bus-live-hssc.rules";

const at = (iso: string) => new Date(iso);
const anchor = (extra: Partial<HsscLiveBus["anchor"]> = {}) => ({ vehicleId: "32149", seq: 2, isDeparted: true, since: at("2026-10-20T00:59:00Z"), observedAt: at("2026-10-20T00:59:00Z"), ...extra });

function bus(extra: Partial<HsscLiveBus> = {}): HsscLiveBus {
  return { anchor: anchor(), stationIndex: 8, isAtStopPosition: true, isLayingOver: false, departsAt: null, lapTimes: [], ...extra };
}

describe("toHsscCall", () => {
  const common = { vehicleId: "32149", observedAt: at("2026-10-20T00:59:00Z") };
  const empty = { expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null, runId: null, runDepartureAt: null };

  it("serves an en-route bus with its expected arrival", () => {
    // Act & Assert
    expect(toHsscCall({ ...common, status: "enRoute", stopsAway: 2, arrivesAt: at("2026-10-20T01:03:00Z") })).toEqual({
      ...empty,
      status: "enRoute",
      expectedArrivalAt: at("2026-10-20T01:03:00Z"),
      basis: "estimate",
      stopsAway: 2,
      isLastBus: null,
      vehicleId: "32149",
      providerText: null,
    });
  });

  it("serves a bus standing at the stop as arriving, 0 stops away, with no departure instant", () => {
    // Act & Assert
    // WHY: Seoul BIS signage shows a standing bus as arriving until it leaves (ADR 0019, D14); the dwell median is no departure time.
    expect(toHsscCall({ ...common, status: "arriving", stopsAway: 0, departsAt: at("2026-10-20T01:00:40Z") })).toEqual({
      ...empty,
      status: "arriving",
      basis: "estimate",
      stopsAway: 0,
      isLastBus: null,
      vehicleId: "32149",
      providerText: null,
    });
  });

  it("serves a bus behind the layover with no instant", () => {
    // Act & Assert
    expect(toHsscCall({ ...common, status: "waitingToDepart", stopsAway: 5 })).toEqual({ ...empty, status: "waitingToDepart", basis: "estimate", stopsAway: 5, isLastBus: null, vehicleId: "32149", providerText: null });
  });
});

describe("toHsscPositionStatus", () => {
  it.each([
    ["laying over", bus({ anchor: anchor({ seq: 5, isDeparted: false }), stationIndex: 0, isLayingOver: true }), "waitingToDepart"],
    ["at a stop", bus({ anchor: anchor({ isDeparted: false }), lapTimes: [{ stationIndex: 9, arrivesAt: at("2026-10-20T01:01:00Z"), departsAt: null }] }), "atStop"],
    ["at a rotary pass", bus({ anchor: anchor({ seq: 1, isDeparted: false }), isAtStopPosition: false, lapTimes: [{ stationIndex: 8, arrivesAt: at("2026-10-20T01:01:00Z"), departsAt: null }] }), "inTransit"],
    ["having left a stop", bus({ lapTimes: [{ stationIndex: 9, arrivesAt: at("2026-10-20T01:01:00Z"), departsAt: null }] }), "inTransit"],
  ])("a bus %s → %s", (_case, input, expected) => {
    // Act & Assert
    expect(toHsscPositionStatus(input)).toBe(expected);
  });
});

describe("toHsscTrajectory", () => {
  it("runs from its departure through each next stop's arrival and departure, past the last index to the turnaround", () => {
    // Arrange
    const lapTimes = [
      { stationIndex: 9, arrivesAt: at("2026-10-20T01:00:10Z"), departsAt: at("2026-10-20T01:00:40Z") },
      { stationIndex: 10, arrivesAt: at("2026-10-20T01:01:37Z"), departsAt: at("2026-10-20T01:02:10Z") },
      { stationIndex: 0, arrivesAt: at("2026-10-20T01:02:40Z"), departsAt: null },
    ];

    // Act
    const knots = toHsscTrajectory(bus({ lapTimes }));

    // Assert
    expect(knots).toEqual([
      { at: "2026-10-20T09:59:00+09:00", s: 8 },
      { at: "2026-10-20T10:00:10+09:00", s: 9 },
      { at: "2026-10-20T10:00:40+09:00", s: 9 },
      { at: "2026-10-20T10:01:37+09:00", s: 10 },
      { at: "2026-10-20T10:02:10+09:00", s: 10 },
      { at: "2026-10-20T10:02:40+09:00", s: 11 },
    ]);
  });

  it("holds a bus at its stop until it leaves", () => {
    // Arrange
    const standing = bus({ anchor: anchor({ isDeparted: false }), departsAt: at("2026-10-20T01:00:20Z"), lapTimes: [{ stationIndex: 9, arrivesAt: at("2026-10-20T01:00:48Z"), departsAt: null }] });

    // Act & Assert
    expect(toHsscTrajectory(standing)?.slice(0, 2)).toEqual([
      { at: "2026-10-20T09:59:00+09:00", s: 8 },
      { at: "2026-10-20T10:00:20+09:00", s: 8 },
    ]);
  });

  it("never goes back in time when the event is stamped after the next arrival", () => {
    // Arrange
    const skewed = bus({ anchor: anchor({ since: at("2026-10-20T01:00:30Z") }), lapTimes: [{ stationIndex: 9, arrivesAt: at("2026-10-20T01:00:10Z"), departsAt: null }] });

    // Act & Assert
    expect(toHsscTrajectory(skewed)?.map(({ at: knotAt }) => knotAt)).toEqual(["2026-10-20T10:00:30+09:00", "2026-10-20T10:00:30+09:00"]);
  });

  it("is null for a bus laying over, which is not moving", () => {
    // Act & Assert
    expect(toHsscTrajectory(bus({ anchor: anchor({ seq: 5, isDeparted: false }), stationIndex: 0 }))).toBeNull();
  });
});

describe("toHsscCall for an overdue bus", () => {
  it("serves a bus the engine cannot place as unknown, with no instant and no text, so clients skip it", () => {
    // Act & Assert
    expect(toHsscCall({ status: "unknown", vehicleId: "32149", stopsAway: 2, observedAt: at("2026-10-20T00:50:00Z") })).toEqual({
      status: "unknown",
      expectedArrivalAt: null,
      expectedDepartureAt: null,
      scheduledArrivalAt: null,
      scheduledDepartureAt: null,
      basis: "estimate",
      stopsAway: 2,
      isLastBus: null,
      vehicleId: "32149",
      providerText: null,
      runId: null,
      runDepartureAt: null,
    });
  });
});

describe("toHsscPositionStatus for an overdue bus", () => {
  it.each([
    ["still laying over off the turnaround after the feed said it left", bus({ anchor: anchor({ seq: 5 }), stationIndex: 0, isLayingOver: true }), "waitingToDepart"],
    ["stalled mid-route, kept where it was last seen", bus({ isLayingOver: false }), "inTransit"],
  ])("a bus %s → %s", (_case, input, expected) => {
    // Act & Assert
    expect(toHsscPositionStatus(input)).toBe(expected);
  });

  it("gives a stalled bus no trajectory", () => {
    // Act & Assert
    expect(toHsscTrajectory(bus({ isLayingOver: false }))).toBeNull();
  });
});
