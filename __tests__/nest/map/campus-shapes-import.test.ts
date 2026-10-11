/**
 * The campus geometry authoring reader — `scripts/lib/campus-shapes-file.js`.
 *
 * Sibling of `map-places-import.test.ts` and deliberately the same shape: one
 * file in, one document per shape out, every failure naming its own path,
 * nothing written when anything is wrong. The geometry rules themselves are
 * shared with the event sheet (`geojson-geometry.js`), so what is worth pinning
 * here is the half that differs — `layerId`, `skkuId`, and the all-or-nothing
 * accounting.
 */

// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import.
const { parseCampusShapesFile } = require("../../../scripts/lib/campus-shapes-file");

import { campusShapeDoc } from "../../../src/building/building.schema";

const RING = [
  [126.9944, 37.5873],
  [126.9954, 37.5873],
  [126.9954, 37.5883],
  [126.9944, 37.5883],
  [126.9944, 37.5873],
];

function parse(over: Record<string, unknown> = {}, shapes?: unknown[]) {
  const doc = {
    shapes: shapes ?? [
      {
        id: "bldg-2-footprint",
        campus: "hssc",
        layerId: "building_labels",
        geometry: { type: "Polygon", coordinates: [RING] },
        title: "수선관 외곽",
        skkuId: 2,
        order: 0,
        ...over,
      },
    ],
  };
  return parseCampusShapesFile(JSON.stringify(doc));
}

describe("parseCampusShapesFile", () => {
  it("reads a footprint into a storable document", () => {
    const { docs, errors } = parse();

    expect(errors).toEqual([]);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      _id: "bldg-2-footprint",
      campus: "hssc",
      layerId: "building_labels",
      // Verbatim — nothing is reshaped on the way in, which is what lets the
      // projection serve it without reshaping it on the way out.
      geometry: { type: "Polygon", coordinates: [RING] },
      title: { ko: "수선관 외곽", en: "수선관 외곽" },
      skkuId: 2,
      order: 0,
    });
  });

  it("accepts null skkuId for geometry that is not a building", () => {
    // A campus boundary or a walking path. This is what makes it a backdrop:
    // the projection turns it into `tap: null`.
    const { docs, errors } = parse({ id: "hssc-boundary", skkuId: null });

    expect(errors).toEqual([]);
    expect(docs[0].skkuId).toBeNull();
  });

  it("refuses an ABSENT skkuId rather than defaulting it", () => {
    // Absent is not the same as null. Forgetting the field must not silently
    // make a footprint inert — that would be a tap target quietly disappearing
    // with nothing anywhere saying why.
    const { docs, errors } = parse({ skkuId: undefined });

    expect(docs).toHaveLength(0);
    expect(errors.join(" ")).toMatch(/skkuId must be an integer, or null/);
  });

  it("falls back to Korean when no English title is authored", () => {
    const { docs } = parse({ title: { ko: "금잔디" } });
    expect(docs[0].title).toEqual({ ko: "금잔디", en: "금잔디" });
  });

  it("rejects an unknown campus", () => {
    const { docs, errors } = parse({ campus: "hsscc" });
    expect(docs).toHaveLength(0);
    expect(errors.join(" ")).toMatch(/campus must be one of/);
  });

  it("rejects a blank layerId, which would draw nothing and say nothing", () => {
    const { docs, errors } = parse({ layerId: "" });
    expect(docs).toHaveLength(0);
    expect(errors.join(" ")).toMatch(/layerId must be a non-empty string/);
  });

  it("rejects a missing order rather than defaulting it to 0", () => {
    const { errors } = parse({ order: undefined });
    expect(errors.join(" ")).toMatch(/order must be a finite number/);
  });

  it("inherits the shared geometry guards", () => {
    // The same reader the event sheet uses, so a swapped paste is caught here
    // too rather than drawing a shape across the Yellow Sea.
    const swapped = RING.map(([lng, lat]) => [lat, lng]);
    const { docs, errors } = parse({
      geometry: { type: "Polygon", coordinates: [swapped] },
    });

    expect(docs).toHaveLength(0);
    expect(errors.join(" ")).toMatch(/is not a longitude|may be swapped/);
  });

  it("rejects a duplicate id instead of silently overwriting its twin", () => {
    const one = {
      id: "dup",
      campus: "hssc",
      layerId: "building_labels",
      geometry: { type: "Polygon", coordinates: [RING] },
      title: "A",
      skkuId: null,
      order: 0,
    };
    const { docs, errors } = parse({}, [one, { ...one, title: "B" }]);

    // On upsert the second would overwrite the first, leaving one shape missing
    // and the import reporting success.
    expect(docs).toHaveLength(1);
    expect(errors.join(" ")).toMatch(/duplicates an earlier id/);
  });

  it("counts rows rather than messages when one shape has several problems", () => {
    const { docs } = parse({ campus: "nope", order: undefined, layerId: "" });
    // One bad row is one rejected row, whatever it is wrong about.
    expect(docs).toHaveLength(0);
  });

  it("reports a malformed file rather than throwing", () => {
    expect(parseCampusShapesFile("{not json")).toEqual({
      docs: [],
      errors: [expect.stringContaining("not valid JSON")],
    });
    expect(parseCampusShapesFile("{}")).toEqual({
      docs: [],
      errors: ["shapes must be an array"],
    });
  });

  it("accepts the committed sheet, whatever is in it", () => {
    // The file ships empty and gets filled in as somebody draws. An empty
    // collection is an ordinary answer, not a broken one — but the file must
    // always parse, or the next import fails for a reason nobody expects.
    const fs = require("fs");
    const path = require("path");
    const real = fs.readFileSync(
      path.join(__dirname, "../../../scripts/data/campus-shapes.json"),
      "utf8",
    );
    expect(parseCampusShapesFile(real).errors).toEqual([]);
  });

  it("writes only documents the server's read schema accepts", () => {
    // The importer and building.schema.ts's campusShapeDoc are two readings of
    // one document. A shape the importer stores but the server's parse drops
    // would vanish from the campus map with only a warning to show for it.
    const fs = require("fs");
    const path = require("path");
    const real = fs.readFileSync(path.join(__dirname, "../../../scripts/data/campus-shapes.json"), "utf8");
    const docs = [
      ...parse().docs,
      ...parse({ skkuId: null, title: { ko: "정문", en: "Main gate" }, subtitle: "인사캠" }).docs,
      ...parseCampusShapesFile(real).docs,
    ];
    expect(docs.length).toBeGreaterThanOrEqual(2);
    for (const doc of docs) expect(campusShapeDoc.safeParse(doc).success).toBe(true);
  });
});

describe("parseCampusShapesFile reads skkuId as the server does", () => {
  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects skkuId %p as not a building id and writes nothing",
    (skkuId) => {
      // Act
      const { docs, errors } = parse({ skkuId });

      // Assert
      expect(docs).toHaveLength(0);
      expect(errors).toEqual([
        expect.stringMatching(/^shapes\[0\] \("bldg-2-footprint"\)\.skkuId\b.*positive safe integer/),
      ]);
    },
  );

  it.each([
    [1, true],
    [88, true],
    [null, true],
    [0, false],
    [-1, false],
    [2.5, false],
    [Number.MAX_SAFE_INTEGER + 1, false],
    ["2", false],
  ])("gives skkuId %p the verdict campusShapeDoc gives it (accepted: %p)", (skkuId, accepted) => {
    // Arrange
    const stored = { ...parse().docs[0], skkuId };

    // Act
    const imported = parse({ skkuId }).docs.length === 1;
    const served = campusShapeDoc.safeParse(stored).success;

    // Assert
    // A shape the importer writes but campusShapeDoc drops would vanish from the campus map.
    expect({ imported, served }).toEqual({ imported: accepted, served: accepted });
  });
});
