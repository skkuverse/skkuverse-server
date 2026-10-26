/**
 * A stop a bus ride passes, as the journey serves it (ADR 0022, D4): a `bus_stop` place with its catalog id, name and
 * coords and no platform, tapped open on the map at it when the stop has a page there, and not tappable when it has
 * none (a pole of an unlisted route that no stop aliases).
 */
import { toStopPlace } from "./bus-departures.mapper";

const COORDS = { lat: 37.4486082327, lng: 126.994122992 };

describe("toStopPlace", () => {
  it("is a bus stop tapped open on the map at it when it has a page", () => {
    // Act & Assert
    expect(toStopPlace({ id: "yangjae-exit2", name: "양재역 2번 출구", coords: COORDS }, true)).toEqual({
      kind: "bus_stop",
      id: "yangjae-exit2",
      name: "양재역 2번 출구",
      coords: COORDS,
      platformId: null,
      action: { actionType: "route", actionValue: "/map?place=bus_stop:yangjae-exit2" },
    });
  });

  it("is not tappable when it has no page", () => {
    // Act & Assert
    expect(toStopPlace({ id: "220000009", name: "과천동행정복지센터", coords: COORDS }, false)).toMatchObject({ kind: "bus_stop", id: "220000009", action: null });
  });
});
