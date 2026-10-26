/**
 * The TOPIS door's reshaping: a live route's served call read back as a stop call that toCall serves byte for byte,
 * its null instants staying null; TOPIS's first run as a timetable call naming no vehicle; and the shared vehicle of
 * each vehicle the departures name, a vehicle no departure names left out; a pole's coords on the stored route line,
 * none for a pole the line does not hold or with no line read.
 */
import { toCall } from "../../../shared/call.util";
import type { Call } from "../../../shared/call.wire";
import type { Vehicle } from "../../bus.wire";
import { toBoardVehicles, toFirstRunCall, toInstant, toStationCoords, toStopCall } from "./bus-departures-topis.mapper";

const SERVED: Call = {
  status: "enRoute",
  ...{ expectedArrivalAt: "2026-10-25T19:01:53+09:00", expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
  basis: "provider",
  ...{ stopsAway: 3, runId: null, vehicleId: "200011607", headsign: "호매실동차고지 방면", isFirstRun: null, isLastRun: false, isExpress: null, providerText: "3분20초후[2번째 전]" },
};

const busVehicle = (id: string): Vehicle => ({ id, plateNumber: "경기70아1234", occupancy: null, seatsLeft: 0, isLowFloor: true, position: null, trajectory: null });

describe("toStopCall", () => {
  it("reads a served call back so toCall serves the same call, its null instants null", () => {
    // Act
    const stopCall = toStopCall(SERVED);

    // Assert
    expect(toCall(stopCall)).toEqual(SERVED);
    expect([stopCall.expectedArrivalAt, stopCall.scheduledArrivalAt]).toEqual([new Date("2026-10-25T10:01:53.000Z"), null]);
  });
});

describe("toInstant", () => {
  it("reads a served instant, and null as null", () => {
    // Act & Assert
    expect([toInstant("2026-10-25T18:58:35+09:00"), toInstant(null)]).toEqual([new Date("2026-10-25T09:58:35.000Z"), null]);
  });
});

describe("toFirstRunCall", () => {
  it("is a timetable call at the first run, first of the day, naming no vehicle", () => {
    // Act
    const first = toFirstRunCall(new Date("2026-10-25T20:52:00.000Z"), null);

    // Assert
    expect(toCall(first)).toMatchObject({ status: "scheduled", scheduledArrivalAt: "2026-10-26T05:52:00+09:00", basis: "timetable", vehicleId: null, isFirstRun: true, headsign: null });
  });
});

describe("toBoardVehicles", () => {
  it("keeps the shared fields of each vehicle a departure names", () => {
    // Arrange
    const departure = { lineId: "gyeonggi7800", board: toStopCall(SERVED), alight: null, observedAt: null };

    // Act
    const vehicles = toBoardVehicles([busVehicle("200011607"), busVehicle("200010898")], [departure]);

    // Assert
    expect(vehicles).toEqual({ "200011607": { id: "200011607", occupancy: null, seatsLeft: 0, isLowFloor: true } });
  });
});

describe("toStationCoords", () => {
  const LINE = { stations: [{ topisId: "220000009", arsId: "37033", stationName: "과천동행정복지센터", sequence: 44, lng: 126.994122992, lat: 37.4486082327, isTurnaround: false }] };

  it.each([
    ["a pole the line holds", LINE, "220000009", { lat: 37.4486082327, lng: 126.994122992 }],
    ["a pole the line does not hold", LINE, "220000020", null],
    ["no line read", null, "220000009", null],
  ])("is the coords of %s", (_case, routePath, topisId, expected) => {
    // Act & Assert
    expect(toStationCoords(routePath, topisId)).toEqual(expected);
  });
});
