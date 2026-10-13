/**
 * The shared map schemas: the renderable-place schema the event routes filter
 * places through, kept in step with the places importer
 * (scripts/lib/map-places-file.js, boundary 4.3), and the camera, text and
 * URL pieces the layer-set schema and the mappers build on.
 */
import { WEBVIEW_ORIGIN } from "../infra/origins";
import { i18nTextFile, mapCamera, mediaUrl, renderablePlace, webviewUrl } from "./map.schema";

// The importer is CommonJS and outside tsconfig, so it is required.
const { parsePlacesFile } = require("../../scripts/lib/map-places-file");

type Row = Record<string, unknown>;

const ROW: Row = {
  id: "booth-01",
  category: "booth",
  order: 1,
  lat: 37.29445,
  lng: 126.97175,
  title: "우끼끼친",
  hours: [{ startAt: "2026-10-01T18:00:00+09:00", endAt: "2026-10-01T23:00:00+09:00" }],
  fields: [{ label: "운영", value: "학생회" }],
  actions: [],
};

function imported(row: Row): unknown[] {
  const file = JSON.stringify({ layerSetId: "eskara-2026", campus: "nsc", places: [row] });
  return parsePlacesFile(file, { layerSetId: "eskara-2026" }).docs;
}

const DOC = imported(ROW)[0] as Row;

const THREE_POSITION_RING = { type: "Polygon", coordinates: [[[126.97, 37.29], [126.971, 37.29], [126.97, 37.29]]] };

// Each renderable rule broken once: [rule, the importer row, the stored document].
const BROKEN: Array<[string, Row, Row]> = [
  ["a blank title", { ...ROW, title: "  " }, { ...DOC, title: { ko: "  " } }],
  [
    "a ring too short to close",
    { ...ROW, lat: undefined, lng: undefined, geometry: THREE_POSITION_RING },
    { ...DOC, location: THREE_POSITION_RING },
  ],
  ["hours that are not a list", { ...ROW, hours: "always" }, { ...DOC, hours: "always" }],
  [
    "a window without a start",
    { ...ROW, hours: [{ endAt: "2026-10-01T23:00:00+09:00" }] },
    { ...DOC, hours: [{ endAt: new Date("2026-10-01T14:00:00Z") }] },
  ],
  [
    "an end that is not an instant",
    { ...ROW, hours: [{ startAt: "2026-10-01T18:00:00+09:00", endAt: "late" }] },
    { ...DOC, hours: [{ startAt: new Date("2026-10-01T09:00:00Z"), endAt: "late" }] },
  ],
  ["fields that are not a list", { ...ROW, fields: { label: "운영" } }, { ...DOC, fields: { label: "운영" } }],
  ["actions that are not a list", { ...ROW, actions: { id: "x" } }, { ...DOC, actions: { id: "x" } }],
];

describe("renderablePlace agrees with the places importer", () => {
  it("accepts what the importer writes for a valid row", () => {
    // Act
    const docs = imported(ROW);

    // Assert
    expect(docs).toHaveLength(1);
    expect(renderablePlace.safeParse(docs[0]).success).toBe(true);
  });

  it.each(BROKEN)("both refuse %s", (_rule, row, doc) => {
    // Act
    const written = imported(row);
    const read = renderablePlace.safeParse(doc);

    // Assert
    expect(written).toEqual([]);
    expect(read.success).toBe(false);
  });

  it("accepts an open-ended window and a title only in Chinese", () => {
    // Arrange
    const doc = { ...DOC, title: { ko: "", zh: "摊位" }, hours: [{ startAt: new Date(), endAt: null }] };

    // Act & Assert
    expect(renderablePlace.safeParse(doc).success).toBe(true);
  });
});

describe("i18nTextFile", () => {
  it("keeps ko and drops a null translation rather than sending it", () => {
    // Act
    const parsed = i18nTextFile.parse({ ko: "주점", en: null, zh: "酒馆" });

    // Assert
    expect(parsed).toEqual({ ko: "주점", zh: "酒馆" });
    expect(Object.keys(parsed)).toEqual(["ko", "zh"]);
  });

  it.each([{}, { ko: "" }, { ko: "  " }, { ko: "주점", en: "" }])("refuses %j", (text) => {
    // Act & Assert
    expect(i18nTextFile.safeParse(text).success).toBe(false);
  });
});

describe("mapCamera", () => {
  const camera = { lat: 37.295129, lng: 126.971234, zoom: 17.5, tilt: 0, bearing: 6, durationMs: 500 };

  it("keeps a camera's fields in the order the chips serve them", () => {
    // Act
    const parsed = mapCamera.parse({ durationMs: 500, bearing: 6, tilt: 0, zoom: 17.5, lng: 126.971234, lat: 37.295129 });

    // Assert
    expect(Object.keys(parsed)).toEqual(["lat", "lng", "zoom", "tilt", "bearing", "durationMs"]);
  });

  it.each([
    [90, true],
    [90.5, false],
    [-90.5, false],
  ])("treats latitude %d as in range: %s", (lat, inRange) => {
    // Act & Assert
    expect(mapCamera.safeParse({ ...camera, lat }).success).toBe(inRange);
  });

  it.each([
    [180, true],
    [180.5, false],
  ])("treats longitude %d as in range: %s", (lng, inRange) => {
    // Act & Assert
    expect(mapCamera.safeParse({ ...camera, lng }).success).toBe(inRange);
  });
});

describe("webviewUrl and mediaUrl", () => {
  it("resolves a root-relative web view path onto the web view origin", () => {
    // Act & Assert
    expect(webviewUrl.parse("/eskara/entry")).toBe(`${WEBVIEW_ORIGIN}/eskara/entry`);
  });

  it.each(["https://evil.com/x", "/eskara/entry\n", "//evil.com/x", ""])("refuses %j as a web view URL", (value) => {
    // Act & Assert
    expect(webviewUrl.safeParse(value).success).toBe(false);
  });

  it("accepts only objects on the media host", () => {
    // Act & Assert
    expect(mediaUrl.safeParse("https://media.skkuverse.com/a.png").success).toBe(true);
    expect(mediaUrl.safeParse("https://media.skkuverse.com.evil.com/a.png").success).toBe(false);
  });
});
