/**
 * The shared map schemas: the place schemas MapRepository parses each read
 * through (one for the overlay route, one for the sheets; the same renderable
 * rules, kept in step with the places importer, scripts/lib/map-places-file.js,
 * boundary 4.3), and the live activation.
 */
import { liveActivation, overlayPlaceDoc, sheetPlaceDoc } from "./map.schema";

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

describe("overlayPlaceDoc agrees with the places importer", () => {
  it("accepts what the importer writes for a valid row", () => {
    // Act
    const docs = imported(ROW);

    // Assert
    expect(docs).toHaveLength(1);
    expect(overlayPlaceDoc.safeParse(docs[0]).success).toBe(true);
  });

  it.each(BROKEN)("both refuse %s", (_rule, row, doc) => {
    // Act
    const written = imported(row);
    const read = overlayPlaceDoc.safeParse(doc);

    // Assert
    expect(written).toEqual([]);
    expect(read.success).toBe(false);
  });

  it("accepts an open-ended window and a title only in Chinese", () => {
    // Arrange
    const doc = { ...DOC, title: { ko: "", zh: "摊位" }, hours: [{ startAt: new Date(), endAt: null }] };

    // Act & Assert
    expect(overlayPlaceDoc.safeParse(doc).success).toBe(true);
  });
});

const POINT = { type: "Point", coordinates: [126.97175, 37.29445] };
const STORED: Row = {
  _id: "eskara-2026-booth-01",
  campus: "nsc",
  category: "booth",
  location: POINT,
  title: { ko: "우끼끼친" },
  subtitle: null,
  hours: [{ startAt: new Date("2026-10-01T09:00:00Z"), endAt: null, label: { ko: "늦게까지" } }],
  fields: [{ label: { ko: "운영" }, value: { ko: "학생회" } }],
  actions: [],
  order: 1,
  facets: { org: ["council"] },
  orderByOption: { day1: 2 },
  detail: { kind: "booth", blocks: "not checked here", actions: [] },
};

// Every reason a place is not renderable: each refused by both place schemas.
const UNRENDERABLE: Array<[string, Row]> = [
  ["no title", { ...STORED, title: undefined }],
  ["a title that is not text", { ...STORED, title: "우끼끼친" }],
  ["a title blank in every language", { ...STORED, title: { ko: " ", en: "" } }],
  ["no location", { ...STORED, location: undefined }],
  ["a geometry no renderer draws", { ...STORED, location: { type: "MultiPoint", coordinates: [[126.97, 37.29]] } }],
  ["a point with one coordinate", { ...STORED, location: { type: "Point", coordinates: [126.97] } }],
  ["a ring too short to close", { ...STORED, location: THREE_POSITION_RING }],
  ["no hours", { ...STORED, hours: undefined }],
  ["hours that are not a list", { ...STORED, hours: "always" }],
  ["a window without a start", { ...STORED, hours: [{ endAt: null }] }],
  ["a start that is not a Date", { ...STORED, hours: [{ startAt: "2026-10-01", endAt: null }] }],
  ["an invalid Date", { ...STORED, hours: [{ startAt: new Date("x"), endAt: null }] }],
  ["a window without an end", { ...STORED, hours: [{ startAt: new Date("2026-10-01T09:00:00Z") }] }],
  ["no fields", { ...STORED, fields: undefined }],
  ["fields that are not a list", { ...STORED, fields: null }],
  ["no actions", { ...STORED, actions: undefined }],
  ["actions that are not a list", { ...STORED, actions: "none" }],
];

describe("overlayPlaceDoc and sheetPlaceDoc", () => {
  it.each(UNRENDERABLE)("both refuse %s", (_case, doc) => {
    // Act & Assert
    expect(overlayPlaceDoc.safeParse(doc).success).toBe(false);
    expect(sheetPlaceDoc.safeParse(doc).success).toBe(false);
  });

  it("keep a renderable place as stored: a window's label, the geometry and the fields they do not check", () => {
    // Act
    const overlay = overlayPlaceDoc.parse(STORED);
    const sheet = sheetPlaceDoc.parse(STORED);

    // Assert
    expect(overlay).toEqual(STORED);
    expect(sheet).toEqual(STORED);
    expect(overlay.location).toBe(POINT);
  });

  it.each([
    ["no subtitle, order, facets or orderByOption", { ...STORED, subtitle: undefined, order: undefined, facets: undefined, orderByOption: undefined }],
    ["a malformed facets value", { ...STORED, facets: "council" }],
    ["a field or button that is not an object", { ...STORED, fields: [null], actions: [7] }],
    ["an empty window list, meaning always open", { ...STORED, hours: [] }],
  ])("accept a renderable place with %s, as before", (_case, doc) => {
    // Act & Assert
    expect(overlayPlaceDoc.safeParse(doc).success).toBe(true);
    expect(sheetPlaceDoc.safeParse(doc).success).toBe(true);
  });
});

describe("liveActivation", () => {
  it("reads the id and the end, an absent end as none", () => {
    // Arrange
    const until = new Date("2026-10-03T00:00:00Z");

    // Act & Assert
    expect(liveActivation.parse({ _id: "eskara-2026", activeUntil: until })).toEqual({ _id: "eskara-2026", activeUntil: until });
    expect(liveActivation.parse({ _id: "eskara-2026", activeUntil: null })).toEqual({ _id: "eskara-2026", activeUntil: null });
    expect(liveActivation.parse({ _id: "eskara-2026" })).toEqual({ _id: "eskara-2026", activeUntil: null });
  });

  it.each([
    ["an id that is not a layer set id", { _id: 7, activeUntil: null }],
    ["an end that is not a Date", { _id: "eskara-2026", activeUntil: "2026-10-03" }],
  ])("refuses %s", (_case, doc) => {
    // Act & Assert
    expect(liveActivation.safeParse(doc).success).toBe(false);
  });
});
