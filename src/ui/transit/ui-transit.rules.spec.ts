/**
 * A transit item's id, unique across the layout and sent as the analytics
 * item id of a tap: a bus item is `bus:<groupId>`, a subway item
 * `subway:<stationId>`, a group `group:<id>`, and a link item keeps the slug
 * written in the layout, which holds no colon and so never collides with the
 * other three.
 */
import { toTransitItemId } from "./ui-transit.rules";

describe("toTransitItemId", () => {
  it.each([
    [{ kind: "bus", groupId: "hssc" }, "bus:hssc"],
    [{ kind: "subway", stationId: "hyehwa" }, "subway:hyehwa"],
    [{ kind: "group", id: "commute-stations" }, "group:commute-stations"],
    [{ kind: "link", id: "taxi-share" }, "taxi-share"],
  ] as const)("names %j %s", (reference, id) => {
    // Act & Assert
    expect(toTransitItemId(reference)).toBe(id);
  });
});
