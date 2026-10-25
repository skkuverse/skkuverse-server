/**
 * A place as an event overlay: its layer, priority and tap from the category
 * table, its geometry served as stored (a polygon's rings rewound), its
 * windows as ISO instants, and its sheet buttons with the bad ones dropped
 * into the context's log.
 */
import { z } from "zod";
import { hasAnyText } from "../../infra/i18n";
import { WEBVIEW_ORIGIN } from "../../shared/webview-origin.constants";
import type { I18n } from "../../infra/types";
import { isDrawableGeometry } from "../../shared/geojson.util";
import type { MapPlaceDoc, OverlayPlaceDoc } from "../map.document";
import { overlayPlaceDoc } from "../map.schema";
import { toEventOverlay } from "./map-event.mapper";
import type { EventOverlayContext } from "./map-event.types";
import { fixtureLayerSet } from "../../../__tests__/helpers/map/layer-sets-fixture";

const CONFIG = fixtureLayerSet();

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

// The overlay read's checks before PR E2, frozen here as the baseline: a place they accepted reached
// toEventOverlay, so it was served, unless drawing it threw and failed the whole route.
const BASELINE_PLACE = z.looseObject({
  title: z.custom<I18n>((title) => hasAnyText(title as I18n | null)),
  location: z.custom(isDrawableGeometry),
  hours: z.array(z.looseObject({ startAt: z.date(), endAt: z.date().nullable() })),
  fields: z.array(z.unknown()),
  actions: z.array(z.unknown()),
});

const STORED = { ...place(), fields: [{ label: { ko: "운영" }, value: { ko: "학생회" } }] };
const BUTTON = { id: "map", label: { ko: "지도" }, actionType: "webview", actionValue: `${WEBVIEW_ORIGIN}/eskara/map` };
const RING = [[126.97, 37.29], [126.971, 37.29], [126.971, 37.291], [126.97, 37.29]];

// [case, document, accepted before, accepted now]: every row the baseline accepts and the read now refuses throws below.
const EQUIVALENCE: Array<[string, unknown, boolean, boolean]> = [
  ["a valid place", STORED, true, true],
  ["no title", { ...STORED, title: undefined }, false, false],
  ["a title that is not text", { ...STORED, title: "우끼끼친" }, false, false],
  ["a title blank in every language", { ...STORED, title: { ko: " " } }, false, false],
  ["a title only in Chinese", { ...STORED, title: { ko: "", zh: "摊位" } }, true, true],
  ["no location", { ...STORED, location: undefined }, false, false],
  ["a geometry no renderer draws", { ...STORED, location: { type: "MultiPoint", coordinates: [[126.97, 37.29]] } }, false, false],
  ["a polygon", { ...STORED, location: { type: "Polygon", coordinates: [RING] } }, true, true],
  ["a path", { ...STORED, location: { type: "LineString", coordinates: RING } }, true, true],
  ["no hours", { ...STORED, hours: undefined }, false, false],
  ["a window without a start", { ...STORED, hours: [{ endAt: null }] }, false, false],
  ["an invalid Date", { ...STORED, hours: [{ startAt: new Date("x"), endAt: null }] }, false, false],
  ["a window label that is not text", { ...STORED, hours: [{ startAt: new Date(0), endAt: null, label: "late" }] }, true, true],
  ["no fields", { ...STORED, fields: undefined }, false, false],
  ["fields that are not a list", { ...STORED, fields: null }, false, false],
  ["a field that is null", { ...STORED, fields: [null] }, true, false],
  ["a field that is not an object", { ...STORED, fields: [7] }, true, false],
  ["a field with no label or value", { ...STORED, fields: [{}] }, true, false],
  ["a field with no value", { ...STORED, fields: [{ label: { ko: "운영" } }] }, true, false],
  ["a field whose value is null", { ...STORED, fields: [{ label: { ko: "운영" }, value: null }] }, true, false],
  ["a field of plain strings", { ...STORED, fields: [{ label: "운영", value: "학생회" }] }, true, true],
  ["no actions", { ...STORED, actions: undefined }, false, false],
  ["a button that is null", { ...STORED, actions: [null] }, true, false],
  ["a button that is not an object", { ...STORED, actions: [7] }, true, true],
  ["a button with nothing in it", { ...STORED, actions: [{}] }, true, true],
  ["a valid button", { ...STORED, actions: [BUTTON] }, true, true],
  ["an object id, an unknown campus and category, no order", { ...STORED, _id: { $oid: "x" }, campus: "mars", category: 5, order: undefined }, true, true],
  ["a subtitle that is not text", { ...STORED, subtitle: "x" }, true, true],
  ["a document that is not an object", "place", false, false],
  ["a null document", null, false, false],
];

describe("the overlay read against toEventOverlay", () => {
  it.each(EQUIVALENCE)("%s: accepted before %s, now %s", (_case, doc, before, now) => {
    // Act & Assert
    expect(BASELINE_PLACE.safeParse(doc).success).toBe(before);
    expect(overlayPlaceDoc.safeParse(doc).success).toBe(now);
  });

  it.each(EQUIVALENCE.filter(([, , before, now]) => before && !now))("%s: refused now because drawing it throws", (_case, doc) => {
    // Act & Assert
    expect(() => toEventOverlay(doc as OverlayPlaceDoc, context())).toThrow(TypeError);
  });

  it.each(EQUIVALENCE.filter(([, , , now]) => now))("%s: accepted, and drawn without a throw", (_case, doc) => {
    // Act & Assert
    expect(() => toEventOverlay(overlayPlaceDoc.parse(doc), context())).not.toThrow();
  });
});
