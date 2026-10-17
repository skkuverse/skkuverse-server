/**
 * The bus_lane_spans document: one id per bus and pair of GPS times, so a
 * span recorded again is the same document, and a life of 90 days after
 * its later fix.
 */
import { spanDoc } from "./bus-eta-probe.mapper";
import type { LaneSpan } from "./bus-eta-probe.types";

const SPAN: LaneSpan = {
  routeId: "228000175",
  vehId: "228000166",
  direction: "northbound",
  fromAlongM: 24_100,
  toAlongM: 4_300,
  fromAt: new Date("2026-10-16T11:34:00.000Z"),
  toAt: new Date("2026-10-16T11:44:00.000Z"),
  speedKmh: 118.8,
};

describe("spanDoc", () => {
  it("keys a span by route, bus and both GPS times, and expires it 90 days after the later one", () => {
    // Act
    const doc = spanDoc(SPAN);

    // Assert
    expect(doc).toEqual({
      _id: "228000175|228000166|2026-10-16T11:34:00.000Z|2026-10-16T11:44:00.000Z",
      ...SPAN,
      expiresAt: new Date("2027-01-14T11:44:00.000Z"),
    });
  });
});
