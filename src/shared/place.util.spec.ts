/**
 * A tap on a place opens the map at that place (ADR 0022, D4): a bus stop, a subway station or an SKKU building is a
 * `route` link to `/map?place=<kind>:<id>`, the app's link grammar, and a stop area or the rider's own location is not
 * tappable. The path is one any route link policy accepts.
 */
import { isRootRelativePath } from "./link-target.util";
import { toPlaceAction } from "./place.util";

describe("toPlaceAction", () => {
  it.each([
    ["bus_stop", "100000123", "/map?place=bus_stop:100000123"],
    ["bus_stop", "hssc-bus-lot", "/map?place=bus_stop:hssc-bus-lot"],
    ["subway_station", "hyehwa", "/map?place=subway_station:hyehwa"],
    ["skku_building", "1", "/map?place=skku_building:1"],
  ] as const)("routes a %s %s to %s", (kind, id, path) => {
    // Act
    const action = toPlaceAction(kind, id);

    // Assert
    expect(action).toEqual({ actionType: "route", actionValue: path });
    expect(isRootRelativePath(path)).toBe(true);
  });

  it.each([
    ["bus_stop_area", "hyehwa"],
    ["point", null],
  ] as const)("is null for a %s", (kind, id) => {
    // Act & Assert
    expect(toPlaceAction(kind, id)).toBeNull();
  });
});
