/**
 * A Jongno arrival in the live shape (ADR 0019, D1): TOPIS's state becomes the status, its time an instant
 * from the row's mkTm (its travel time, else the time in its text, else unknown), and its end-of-service and no-information texts become
 * the station's operation instead of an arrival. Its stops away count the bus's next stop as 1 (ADR 0019, D4), one more
 * than TOPIS's staOrd − sectOrd, since an arrival row's sectOrd is the next stop's own staOrd, and a bus the positions
 * show standing at the station is 0 and at the stop. A vehicle's occupancy comes from the arrival row nearest ahead of it,
 * its last-bus flag from any row that names it, carried by every arrival naming it, and its plate is TOPIS's full plate.
 * Its low-floor flag is read from TOPIS's bus type: true for a low-floor bus, false for a general one, null otherwise.
 */
import { jongroArrivalBus, jongroPositionDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import type { Arrival } from "../../bus.wire";
import type { JongroBusTracking, TrackedPosition } from "../../realtime/group/bus-realtime-group.types";
import type { RealtimeArrival } from "../../realtime/group/bus-realtime-group.wire";
import {
  toJongroArrival,
  toLowFloor,
  toNearestSlot,
  toOccupancy,
  toOlderInstant,
  toPlateNumber,
  toStationOperation,
  toVehicleStates,
  withVehicleState,
} from "./bus-live-jongro.rules";

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
      stopsAway: 3,
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

describe("toJongroArrival stops away", () => {
  // EVIDENCE: TOPIS's own pairs, 2026-10-17 (topis-jongro-arrivals.json) and 2026-10-22 production: the arriving-soon text has
  // sectOrd == staOrd while the positions put the bus one section behind, and the "N stops before" text has staOrd − sectOrd == N.
  it.each([
    [{ staOrd: 3, sectOrd: 3, arrmsg: "곧 도착" }, 0, 1],
    [{ staOrd: 12, sectOrd: 11, arrmsg: "2분19초후[1번째 전]" }, 1, 2],
    [{ staOrd: 16, sectOrd: 3, arrmsg: "12분41초후[13번째 전]" }, 13, 14],
  ])("counts TOPIS's %j (staOrd − sectOrd %i) as %i, its next stop being 1", (fields, topisCount, stopsAway) => {
    // Arrange
    const counted = slot({ stopsAway: topisCount, message: fields.arrmsg }, 60, jongroArrivalBus(fields));

    // Act & Assert
    expect(toJongroArrival(counted, MADE_AT_MS)?.stopsAway).toBe(stopsAway);
  });
});

const named = (extra: Partial<Arrival> = {}): Arrival => ({
  status: "arriving",
  expectedArrivalAt: "2026-10-20T09:59:40+09:00",
  ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
  basis: "provider",
  stopsAway: 1,
  isLastBus: false,
  vehicleId: "100000103",
  providerText: "곧 도착",
  ...extra,
});
const vehicleStatesOf = (standing: Array<[string, number]>, lastBusIds: string[]) => ({ standingStationIndexById: new Map(standing), lastBusIds: new Set(lastBusIds) });

describe("withVehicleState", () => {
  it.each([
    ["standing at this station", vehicleStatesOf([["100000103", 4]], []), { status: "atStop", stopsAway: 0, isLastBus: false }],
    ["standing at the station before", vehicleStatesOf([["100000103", 3]], []), { status: "arriving", stopsAway: 1, isLastBus: false }],
    ["standing at the station after", vehicleStatesOf([["100000103", 5]], []), { status: "arriving", stopsAway: 1, isLastBus: false }],
    ["the last bus by another row", vehicleStatesOf([], ["100000103"]), { status: "arriving", stopsAway: 1, isLastBus: true }],
  ] as const)("serves a bus %s at station 4 by its state", (_case, vehicleStates, expected) => {
    // Act & Assert
    expect(withVehicleState(named(), 4, vehicleStates)).toMatchObject(expected);
  });

  it("keeps the slot's own flag on an arrival that names no vehicle", () => {
    // Act & Assert
    expect(withVehicleState(named({ vehicleId: null, stopsAway: null, isLastBus: true, status: "waitingToDepart" }), 4, vehicleStatesOf([], []))).toMatchObject({
      status: "waitingToDepart",
      stopsAway: null,
      isLastBus: true,
    });
  });
});

describe("toVehicleStates", () => {
  const trackedAs = (status: JongroBusTracking["status"], sequence: string, vehicleId: string): TrackedPosition => ({
    position: jongroPositionDoc({ sequence, vehicleId }),
    tracking: { status, vehicleId } as JongroBusTracking,
    checkedAt: new Date(MADE_AT_MS),
  });
  const row = (stationIndex: number, ...slots: ReturnType<typeof slot>[]) => ({ stationIndex, madeAtMs: MADE_AT_MS, slots });
  const of = (vehId: string, isLastBus: boolean, stopsAway: number | null = 2) => slot({ isLastBus, stopsAway }, 60, jongroArrivalBus({ vehId }));

  it("places a bus at the stop where its position stands, and no bus in transit or waiting", () => {
    // Arrange
    const positions = [trackedAs("atStop", "5", "100000101"), trackedAs("running", "8", "100000102"), trackedAs("waiting", "1", "100000103")];

    // Act
    const { standingStationIndexById } = toVehicleStates({ rows: [], positions });

    // Assert
    expect([...standingStationIndexById]).toEqual([["100000101", 4]]);
  });

  it.each([
    [[true, false], true],
    [[false, true], true],
    [[false, false], false],
  ])("calls a bus whose rows read %j the last bus: %s", (flags, isLastBus) => {
    // Arrange
    const rows = flags.map((flag, index) => row(index + 2, of("100000103", flag)));

    // Act
    const { lastBusIds } = toVehicleStates({ rows, positions: [] });

    // Assert
    expect(lastBusIds.has("100000103")).toBe(isLastBus);
  });

  it("calls no vehicle the last bus from a slot that names none", () => {
    // Act
    const { lastBusIds } = toVehicleStates({ rows: [row(2, of("0", true, null))], positions: [] });

    // Assert
    expect([...lastBusIds]).toEqual([]);
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

describe("toLowFloor", () => {
  it.each([
    ["lowFloor", true],
    ["general", false],
    // WHY: TOPIS's articulated type says nothing about the floor, so it is no answer rather than false.
    ["articulated", null],
    // WHY: a row a poller older than the field wrote, or one TOPIS sent no documented type for.
    [undefined, null],
  ] as const)("%j → %j", (busType, expected) => {
    // Act & Assert
    expect(toLowFloor(busType)).toBe(expected);
  });
});
