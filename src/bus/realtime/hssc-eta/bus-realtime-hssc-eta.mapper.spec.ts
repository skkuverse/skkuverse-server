/**
 * An HSSC stop event as the engine's anchor (ADR 0018, D1): a departure (`LEFT`, `LEFT_LAST`) is
 * departed since its own instant, any other event at the stop since the bus was first seen there. A departure from the
 * turnaround (seq 5) is not counted: the feed fires it about 70 m past the stop while a bus may lay over just beyond,
 * so the bus is at the turnaround until its next stop's event (ADR 0018, D7).
 */
import { toHsscAnchor } from "./bus-realtime-hssc-eta.mapper";

const EVENT_AT = new Date("2026-10-20T00:59:30Z");
const FIRST_SEEN_AT = new Date("2026-10-20T00:58:00Z");
const event = (inout: string) => ({ vehicleId: "32149", seq: 6, inout, eventAt: EVENT_AT, firstSeenAt: FIRST_SEEN_AT });

describe("toHsscAnchor", () => {
  it.each([
    ["LEFT", true, EVENT_AT],
    ["LEFT_LAST", true, EVENT_AT],
    ["ENTERED", false, FIRST_SEEN_AT],
    ["EMERGENCY", false, FIRST_SEEN_AT],
  ])("%s → departed %s, since %s", (inout, isDeparted, since) => {
    // Act & Assert
    expect(toHsscAnchor(event(inout))).toEqual({ vehicleId: "32149", seq: 6, isDeparted, since, observedAt: EVENT_AT });
  });
});

describe("toHsscAnchor at the turnaround", () => {
  it.each(["LEFT", "ENTERED", "EMERGENCY"])("%s at 농구장 (seq 5) → at the stop since it was first seen there", (inout) => {
    // Act & Assert
    expect(toHsscAnchor({ ...event(inout), seq: 5 })).toEqual({ vehicleId: "32149", seq: 5, isDeparted: false, since: FIRST_SEEN_AT, observedAt: EVENT_AT });
  });
});
