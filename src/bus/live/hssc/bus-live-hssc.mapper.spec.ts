/**
 * The HSSC line in the live shape (ADR 0019, D2, D5, D6, D8): one vehicle per fresh bus with no plate, occupancy, seats,
 * last-bus or low-floor flag the feed never gives, a position from its latest stop event checked when the poller wrote, each stop
 * a station named by its stop id with no pole number, running while a bus is fresh, and no data without one.
 */
import type { HsscEta } from "../../realtime/hssc-eta/bus-realtime-hssc-eta.types";
import { toLiveHsscGroup } from "./bus-live-hssc.mapper";
import type { HsscLiveBus } from "./bus-live-hssc.types";

const at = (iso: string) => new Date(iso);
const CHECKED_AT = at("2026-10-20T00:59:55Z");

const bus: HsscLiveBus = {
  anchor: { vehicleId: "32149", seq: 0, isDeparted: true, since: at("2026-10-20T00:59:00Z"), observedAt: at("2026-10-20T00:59:00Z") },
  stationIndex: 6,
  isAtStopPosition: true,
  isLayingOver: false,
  departsAt: null,
  lapTimes: [{ stationIndex: 7, arrivesAt: at("2026-10-20T01:00:30Z"), departsAt: at("2026-10-20T01:00:42Z") }],
};
const eta = (stopsAway: number, arrivesAt: string): HsscEta => ({ status: "enRoute", vehicleId: "32149", stopsAway, observedAt: at("2026-10-20T00:59:00Z"), arrivesAt: at(arrivesAt) });

describe("toLiveHsscGroup", () => {
  it("serves each fresh bus once and each stop with its estimates", () => {
    // Act
    const group = toLiveHsscGroup({ stations: [{ stationIndex: 8, stopId: "hssc-skku-junction", etas: [eta(1, "2026-10-20T01:01:52Z")] }], buses: [bus], checkedAt: CHECKED_AT });

    // Assert
    expect(group).toEqual({
      groupId: "hssc",
      stationsVersion: null,
      updatedAt: "2026-10-20T09:59:55+09:00",
      operation: "running",
      vehicles: [
        {
          id: "32149",
          plateNumber: null,
          occupancy: null,
          seatsLeft: null,
          isLastBus: null,
          isLowFloor: null,
          position: {
            stationIndex: 6,
            status: "inTransit",
            progress: null,
            sectionMeters: null,
            coords: null,
            nextStationAt: "2026-10-20T10:00:30+09:00",
            positionAt: "2026-10-20T09:59:00+09:00",
            checkedAt: "2026-10-20T09:59:55+09:00",
          },
          trajectory: [
            { at: "2026-10-20T09:59:00+09:00", s: 6 },
            { at: "2026-10-20T10:00:30+09:00", s: 7 },
            { at: "2026-10-20T10:00:42+09:00", s: 7 },
          ],
        },
      ],
      stations: [
        {
          stationIndex: 8,
          stopId: "hssc-skku-junction",
          arsId: null,
          operation: "running",
          arrivals: [
            {
              status: "enRoute",
              expectedArrivalAt: "2026-10-20T10:01:52+09:00",
              ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
              basis: "estimate",
              stopsAway: 1,
              isLastBus: null,
              vehicleId: "32149",
              providerText: null,
            },
          ],
        },
      ],
    });
  });

  it("lists at most two arrivals at a station", () => {
    // Arrange
    const etas = [eta(1, "2026-10-20T01:01:00Z"), eta(3, "2026-10-20T01:04:00Z"), eta(6, "2026-10-20T01:09:00Z")];

    // Act
    const group = toLiveHsscGroup({ stations: [{ stationIndex: 8, stopId: "hssc-skku-junction", etas }], buses: [bus], checkedAt: CHECKED_AT });

    // Assert
    expect(group.stations[0]!.arrivals.map(({ stopsAway }) => stopsAway)).toEqual([1, 3]);
  });

  it("serves no data when no bus is fresh, and no write instant before the poller wrote", () => {
    // Act
    const group = toLiveHsscGroup({ stations: [], buses: [], checkedAt: null });

    // Assert
    expect(group).toEqual({ groupId: "hssc", stationsVersion: null, updatedAt: null, operation: "noData", vehicles: [], stations: [] });
  });
});
