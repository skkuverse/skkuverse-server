/**
 * A transit item's id, unique across the layout and sent as the analytics
 * item id of a tap: a bus item is `bus:<groupId>`, a subway item
 * `subway:<stationId>`, and a link item keeps the slug written in the layout,
 * which holds no colon and so never collides with the other two.
 */
import { toTransitItemId } from "./ui-transit.rules";

describe("toTransitItemId", () => {
  it.each([
    [{ kind: "bus", groupId: "hssc" }, "bus:hssc"],
    [{ kind: "subway", stationId: "hyehwa" }, "subway:hyehwa"],
    [{ kind: "link", id: "taxi-share" }, "taxi-share"],
  ] as const)("names %j %s", (reference, id) => {
    // Act & Assert
    expect(toTransitItemId(reference)).toBe(id);
  });
});
