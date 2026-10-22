/**
 * A Jongno arrival in the live shape (ADR 0019, D1): TOPIS's state becomes the status, its time an instant
 * from the row's mkTm (its travel time, else the time in its text, else unknown), and its end-of-service and no-information texts become
 * the station's operation instead of an arrival. A vehicle's occupancy and last-bus flag come from the arrival row
 * nearest ahead of it, and its plate is TOPIS's full plate.
 */
import { jongroArrivalBus } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import type { RealtimeArrival } from "../../realtime/group/bus-realtime-group.wire";
import { toJongroArrival, toNearestSlot, toOccupancy, toOlderInstant, toPlateNumber, toStationOperation } from "./bus-live-jongro.rules";

const MADE_AT_MS = Date.parse("2026-10-20T00:59:00Z");

const realtimeArrival = (extra: Partial<RealtimeArrival> = {}): RealtimeArrival => ({
  minutes: 3,
  stopsAway: 2,
  state: "running",
  isLastBus: false,
  carNumber: "5537",
  crowding: "relaxed",
  passengerCount: 9,
  message: "3분5초후[2번째 전]",
  ...extra,
});
const slot = (arrival: Partial<RealtimeArrival> = {}, travelSeconds: number | null = 185, bus = jongroArrivalBus()) => ({ bus, arrival: realtimeArrival(arrival), travelSeconds });

describe("toJongroArrival", () => {
  it("serves a running bus en route at mkTm plus its travel time, TOPIS's prediction", () => {
    // Act & Assert
    expect(toJongroArrival(slot(), MADE_AT_MS)).toEqual({
      status: "enRoute",
      expectedArrivalAt: "2026-10-20T10:02:05+09:00",
      expectedDepartureAt: null,
      scheduledArrivalAt: null,
      scheduledDepartureAt: null,
      basis: "provider",
      stopsAway: 2,
      isLastBus: false,
      vehicleId: "100000103",
      providerText: "3분5초후[2번째 전]",
    });
  });

  it.each([
    ["arriving", 40, "arriving", "2026-10-20T09:59:40+09:00"],
    ["arriving", null, "arriving", null],
    ["waiting", 240, "waitingToDepart", null],
    ["unknown", 120, "unknown", null],
    ["running", null, "unknown", null],
  ] as const)("serves TOPIS state %s with %s seconds as %s at %s", (state, travelSeconds, status, expectedArrivalAt) => {
    // Act
    const arrival = toJongroArrival(slot({ state }, travelSeconds), MADE_AT_MS);

    // Assert
    expect(arrival).toMatchObject({ status, expectedArrivalAt });
  });

  it("serves no instant when the row's mkTm did not parse", () => {
    // Act & Assert
    expect(toJongroArrival(slot(), null)).toMatchObject({ status: "unknown", expectedArrivalAt: null });
  });

  it.each(["ended", "noInfo"] as const)("serves no arrival for %s, which is the station's operation", (state) => {
    // Act & Assert
    expect(toJongroArrival(slot({ state }), MADE_AT_MS)).toBeNull();
  });

  it("names no vehicle for a slot TOPIS names none for", () => {
    // Act
    const arrival = toJongroArrival(slot({ state: "waiting", stopsAway: null, carNumber: null }, null, jongroArrivalBus({ vehId: "0" })), MADE_AT_MS);

    // Assert
    expect(arrival).toMatchObject({ vehicleId: null, stopsAway: null });
  });
});

describe("toStationOperation", () => {
  it.each([
    [["running"], "running"],
    [["ended", "ended"], "ended"],
    [["ended"], "ended"],
    [["noInfo", "noInfo"], "noData"],
    [["ended", "noInfo"], "noData"],
    [["running", "ended"], "running"],
    [["waiting"], "running"],
    [[], "noData"],
  ] as const)("slots %j → %s", (states, expected) => {
    // Act & Assert
    expect(toStationOperation(states.map((state) => slot({ state })))).toBe(expected);
  });
});

describe("toNearestSlot", () => {
  const at = (staOrd: number) => slot({}, 60, jongroArrivalBus({ staOrd }));

  it("takes the row of the vehicle's next stop", () => {
    // Act & Assert
    expect(toNearestSlot([at(3), at(8), at(7)], 6)?.bus.staOrd).toBe(7);
  });

  it("takes the first row in station order when none is its next stop, or its position is unknown", () => {
    // Act & Assert
    expect([toNearestSlot([at(9), at(3)], 6)?.bus.staOrd, toNearestSlot([at(9), at(3)], null)?.bus.staOrd]).toEqual([3, 3]);
  });

  it("answers none when no row names the vehicle", () => {
    // Act & Assert
    expect(toNearestSlot([], 6)).toBeUndefined();
  });
});

describe("toOccupancy", () => {
  it.each([
    [{ crowding: "relaxed", passengerCount: 9 }, { level: "relaxed", passengerCount: 9 }],
    [{ crowding: "crowded", passengerCount: null }, { level: "crowded", passengerCount: null }],
    [{ crowding: null, passengerCount: null }, null],
  ] as const)("%j → %j", (fields, expected) => {
    // Act & Assert
    expect(toOccupancy(realtimeArrival(fields))).toEqual(expected);
  });
});

describe("toPlateNumber", () => {
  it.each([
    ["서울74사5537", "서울74사5537"],
    [" 서울74사5537 ", "서울74사5537"],
    [" ", null],
    ["", null],
  ])("%j → %j", (plainNo, expected) => {
    // Act & Assert
    expect(toPlateNumber(plainNo)).toBe(expected);
  });
});

describe("toOlderInstant", () => {
  const [earlier, later] = [new Date("2026-10-20T00:59:30Z"), new Date("2026-10-20T00:59:55Z")];

  it.each([
    [earlier, later, earlier],
    [later, earlier, earlier],
    [null, later, later],
    [earlier, null, earlier],
    [null, null, null],
  ])("%s and %s → %s", (a, b, expected) => {
    // Act & Assert
    expect(toOlderInstant(a, b)).toEqual(expected);
  });
});
