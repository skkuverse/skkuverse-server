/**
 * An HSSC stop event as the engine's anchor (ADR 0018, D1): a departure (`LEFT`, `LEFT_LAST`) is
 * departed since its own instant, any other event at the stop since the bus was first seen there.
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
