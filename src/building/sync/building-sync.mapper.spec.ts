/**
 * enrichBuilding: the enriched layer derived from a raw building. A raw
 * document missing name, description or accessibility is a broken import, not
 * a building with blank fields: enrichment throws, so phase 1 fails loudly
 * instead of writing blanks (every production document has all three).
 */
import type { BuildingRawDoc } from "../building.document";
import { ENRICH_VERSION, enrichBuilding } from "./building-sync.mapper";

const RAW = {
  _id: 27,
  buildNo: "227",
  campus: "nsc",
  name: { ko: "제1공학관", en: "Engineering Hall 1" },
  description: { ko: "공학 강의동", en: "Lecture building" },
  location: { type: "Point", coordinates: [126.9766, 37.2939] },
  image: { url: "https://www.skku.edu/a.jpg", filename: "a.jpg" },
  accessibility: { elevator: true, toilet: false },
  skkuCreatedAt: "2020-03-02",
  skkuUpdatedAt: "2026-09-01",
} as unknown as BuildingRawDoc;

describe("enrichBuilding", () => {
  it("derives the display number and type and copies the bilingual fields", () => {
    // Act
    const enriched = enrichBuilding(RAW);

    // Assert
    expect(enriched).toEqual({
      buildNo: "227",
      displayNo: "27",
      type: "building",
      campus: "nsc",
      name: { ko: "제1공학관", en: "Engineering Hall 1" },
      description: { ko: "공학 강의동", en: "Lecture building" },
      location: RAW.location,
      image: RAW.image,
      attachments: [],
      accessibility: { elevator: true, toilet: false, detail: null },
      enrichVersion: ENRICH_VERSION,
      skkuCreatedAt: "2020-03-02",
      skkuUpdatedAt: "2026-09-01",
    });
  });

  it("types a building without a buildNo as a facility with no display number", () => {
    // Act
    const enriched = enrichBuilding({ ...RAW, buildNo: null });

    // Assert
    expect(enriched).toMatchObject({ buildNo: null, displayNo: null, type: "facility" });
  });

  it("keeps an empty Korean description empty", () => {
    // Act
    const enriched = enrichBuilding({ ...RAW, description: { ko: "", en: "" } });

    // Assert
    expect(enriched.description).toEqual({ ko: "", en: "" });
    expect(enriched.accessibility.detail).toBeNull();
  });

  it.each(["name", "description", "accessibility"])("throws on a raw building without %s", (field) => {
    // Arrange
    const broken: Record<string, unknown> = { ...RAW };
    delete broken[field];

    // Act & Assert
    expect(() => enrichBuilding(broken as unknown as BuildingRawDoc)).toThrow(TypeError);
  });
});
