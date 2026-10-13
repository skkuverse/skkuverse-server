/**
 * A place as an event overlay: its layer, priority and tap from the category
 * table, its geometry served as stored (a polygon's rings rewound), its
 * windows as ISO instants, and its sheet buttons with the bad ones dropped
 * into the context's log.
 */
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { MapPlaceDoc } from "../map.document";
import { toEventOverlay } from "./map-event.mapper";
import type { EventOverlayContext } from "./map-event.types";
import { shippedLayerSet } from "../../../__tests__/helpers/map/shipped-layer-set";

const CONFIG = shippedLayerSet();

function context(): EventOverlayContext {
  return { layerSet: CONFIG, drops: { actions: [], facets: [] }, isKnownMiniAppTarget: () => true };
}

function place(over: Partial<MapPlaceDoc> = {}): MapPlaceDoc {
  return {
    _id: "eskara-2026-booth-01",
    layerSetId: "eskara-2026",
    campus: "nsc",
    category: "booth",
    location: { type: "Point", coordinates: [126.971747, 37.294452] },
    title: { ko: "우끼끼친" },
    hours: [{ startAt: new Date("2026-10-01T09:00:00Z"), endAt: null }],
    fields: [],
    actions: [],
    order: 10,
    updatedAt: new Date(0),
    ...over,
  };
}

describe("toEventOverlay", () => {
  it("draws a booth as a marker on its category's layer, tapping to the place", () => {
    // Act
    const overlay = toEventOverlay(place(), context());

    // Assert
    expect(overlay).toMatchObject({
      kind: "marker",
      layerId: "eskara26_booth",
      text: { ko: "우끼끼친", en: "우끼끼친" },
      subtitle: null,
      hours: [{ startAt: "2026-10-01T09:00:00.000Z", endAt: null, label: null }],
      locationAccuracy: "exact",
      tap: { kind: "event", placeId: "eskara-2026-booth-01" },
    });
  });

  it("serves a point exactly as stored, by reference", () => {
    // Arrange
    const doc = place();

    // Act & Assert
    expect(toEventOverlay(doc, context()).geometry).toBe(doc.location);
  });

  it("draws a line as a path with no marker-only fields", () => {
    // Act
    const overlay = toEventOverlay(place({ location: { type: "LineString", coordinates: [[126.97, 37.29], [126.98, 37.29]] } }), context());

    // Assert
    expect(overlay.kind).toBe("path");
    expect(overlay).not.toHaveProperty("pinPriority");
  });

  it("ships valid buttons with a webview value made absolute, and logs the bad ones", () => {
    // Arrange
    const ctx = context();
    const actions = [
      { id: "map", label: { ko: "지도" }, actionType: "webview" as const, actionValue: "/eskara/map", style: "primary" as const },
      { id: "bad", label: { ko: "나쁨" }, actionType: "route" as const, actionValue: "https://evil.com" },
    ];

    // Act
    const overlay = toEventOverlay(place({ actions }), ctx);

    // Assert
    expect(overlay.actions).toEqual([
      { id: "map", label: { ko: "지도", en: "지도" }, actionType: "webview", actionValue: `${WEBVIEW_ORIGIN}/eskara/map`, style: "primary" },
    ]);
    expect(ctx.drops.actions).toEqual(['bad: actionValue "https://evil.com" is not valid for actionType "route"']);
  });
});
