/**
 * withHeadsigns heads each call of a live group where its station's direction is (ADR 0022, D2): the direction's
 * label at the station's index, null where the station has none or the list stops short, the call's key order and
 * everything but the headsign unchanged.
 */
import type { LiveGroup } from "../bus-live.wire";
import { withHeadsigns } from "./bus-live-group.mapper";

const call = {
  ...{ status: "enRoute" as const, expectedArrivalAt: "2026-10-20T14:13:50+09:00", expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
  ...{ basis: "provider" as const, stopsAway: 2, runId: null, vehicleId: "100000201", headsign: null },
  ...{ isFirstRun: null, isLastRun: true, isExpress: null, providerText: "4분10초후[2번째 전]" },
};
const station = (stationIndex: number, arrivals = [call]) => ({ stationIndex, stopId: null, arsId: null, operation: "running" as const, arrivals });
const group = (stations: LiveGroup["stations"]): LiveGroup => ({ groupId: "jongro07", stationsVersion: "v1", updatedAt: null, operation: "running", vehicles: [], stations });

describe("withHeadsigns", () => {
  it("heads each call with its own station's direction label, by station index, not by the station's place in the list", () => {
    // Arrange
    const directions = [null, { id: "a", label: "To A" }, { id: "b", label: "To B" }];

    // Act
    const headed = withHeadsigns(group([station(2), station(1)]), directions);

    // Assert
    expect(headed.stations.map(({ arrivals }) => arrivals.map(({ headsign }) => headsign))).toEqual([["To B"], ["To A"]]);
  });

  it("heads no call at a station with no direction, or past the end of the directions", () => {
    // Act
    const headed = withHeadsigns(group([station(0), station(5)]), [null, { id: "a", label: "To A" }]);

    // Assert
    expect(headed.stations.map(({ arrivals }) => arrivals.map(({ headsign }) => headsign))).toEqual([[null], [null]]);
  });

  it("changes nothing but the headsign, keeping each call's key order", () => {
    // Act
    const [headed] = withHeadsigns(group([station(0)]), [{ id: "a", label: "To A" }]).stations;

    // Assert
    expect(headed!.arrivals).toEqual([{ ...call, headsign: "To A" }]);
    expect(Object.keys(headed!.arrivals[0]!)).toEqual(Object.keys(call));
  });
});
