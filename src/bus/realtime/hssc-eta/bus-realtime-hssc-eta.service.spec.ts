/**
 * BusRealtimeHsscEtaService, the engine's door for the live route: stop events become anchors, and a station of the
 * HSSC line is asked about by its index, which the engine turns into the feed's seq.
 */
import { BusRealtimeHsscEtaService } from "./bus-realtime-hssc-eta.service";

const NOW = new Date("2026-10-20T01:00:00Z");
const service = new BusRealtimeHsscEtaService();

describe("BusRealtimeHsscEtaService.toAnchors", () => {
  it("anchors each stop event", () => {
    // Arrange
    const event = { vehicleId: "32149", seq: 0, inout: "LEFT", eventAt: new Date("2026-10-20T00:59:50Z"), firstSeenAt: new Date("2026-10-20T00:57:00Z") };

    // Act & Assert
    expect(service.toAnchors([event])).toEqual([{ vehicleId: "32149", seq: 0, isDeparted: true, since: event.eventAt, observedAt: event.eventAt }]);
  });
});

describe("BusRealtimeHsscEtaService.toStationEtas", () => {
  it("answers the ETAs at the line's station, the turnaround being station 0", () => {
    // Arrange
    const anchor = { vehicleId: "32149", seq: 4, isDeparted: true, since: new Date("2026-10-20T00:59:50Z"), observedAt: NOW };

    // Act
    const [eta] = service.toStationEtas([anchor], 0, NOW);

    // Assert
    expect(eta).toEqual({ status: "enRoute", vehicleId: "32149", stopsAway: 1, observedAt: NOW, arrivesAt: new Date("2026-10-20T01:00:20Z") });
  });
});

describe("BusRealtimeHsscEtaService.toLapTimes", () => {
  it("answers the lap times by the line's station index", () => {
    // Arrange
    const anchor = { vehicleId: "32149", seq: 4, isDeparted: true, since: NOW, observedAt: NOW };

    // Act & Assert
    expect(service.toLapTimes(anchor, NOW)).toEqual([{ stationIndex: 0, arrivesAt: new Date("2026-10-20T01:00:30Z"), departsAt: null }]);
  });
});

describe("BusRealtimeHsscEtaService.toStationIndex", () => {
  it("answers the line's index of a seq", () => {
    // Act & Assert
    expect(service.toStationIndex(0)).toBe(6);
  });
});
