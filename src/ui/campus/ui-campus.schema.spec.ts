/**
 * The structure of the campus-banners dataset: revision 1
 * (fixtures/campus-banners.dataset.json) parses, a copy missing any carousel
 * field does not, and the carousel id and its banner ids are one namespace.
 *
 * storedCampusBanners parses the `campus-banners` document as
 * scripts/lib/datasets/store.js writes it: a positive whole revision and the
 * carousel as its data.
 */
import fs from "fs";
import path from "path";
import { campusBannersFile, storedCampusBanners } from "./ui-campus.schema";

const FIXTURE = path.join(__dirname, "../../../__tests__/nest/ui/fixtures/campus-banners.dataset.json");

/** Revision 1 of the campus banners, without the fixture's provenance note. */
function revisionOne(): Record<string, unknown> {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  delete data._about;
  return data;
}

describe("campusBannersFile", () => {
  it("parses revision 1 of the dataset", () => {
    // Act & Assert
    expect(campusBannersFile.safeParse(revisionOne()).success).toBe(true);
  });

  it.each(Object.keys(campusBannersFile.shape))("refuses a carousel without its %s", (field) => {
    // Arrange
    const rest = revisionOne();
    delete rest[field];

    // Act & Assert
    expect(campusBannersFile.safeParse(rest).success).toBe(false);
  });

  it("refuses two banners with one id", () => {
    // Arrange
    const banners = revisionOne();
    const [first] = banners.items as Record<string, unknown>[];
    const twice = { ...banners, items: [first, first] };

    // Act & Assert
    expect(campusBannersFile.safeParse(twice).success).toBe(false);
  });
});

describe("campusBannersFile, on carousels a push refuses", () => {
  const IMAGE_URL = "https://media.skkuverse.com/campus/banners/test-00000000.webp";

  function image(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { type: "image", id: "banner-a", imageUrl: IMAGE_URL, alt: { ko: "현수막" }, ...overrides };
  }

  function carousel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { type: "banner_carousel", id: "campus_banners", aspectRatio: 6, autoRotateSec: 4, items: [image()], ...overrides };
  }

  const issuesOf = (raw: unknown): string[] => {
    const parsed = campusBannersFile.safeParse(raw);
    return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  };

  it("accepts a 6:1 image-only carousel", () => {
    // Act & Assert
    expect(campusBannersFile.safeParse(carousel()).success).toBe(true);
  });

  it.each<[string, unknown, string]>([
    ["a non-object root", [], ""],
    ["a section type other than banner_carousel", carousel({ type: "tile_grid" }), "type"],
    ["a missing id", carousel({ id: undefined }), "id"],
    ["the home default item", carousel({ items: [image(), { type: "default" }] }), "items.1.type"],
    ["an aspect ratio above 6", carousel({ aspectRatio: 7 }), "aspectRatio"],
    ["an image off the media bucket", carousel({ items: [image({ imageUrl: "https://evil.com/a.webp" })] }), "items.0.imageUrl"],
    ["an empty items list", carousel({ items: [] }), "items"],
  ])("refuses %s, at its path", (_label, raw, at) => {
    // Act
    const issues = issuesOf(raw);

    // Assert
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(new RegExp(`^${at.replace(/\./g, "\\.")}: `));
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["an image id repeated", carousel({ items: [image(), image()] }), 'items.1.id: duplicate id "banner-a"'],
    ["the carousel id repeated by an image", carousel({ items: [image({ id: "campus_banners" })] }), 'items.0.id: duplicate id "campus_banners"'],
  ])("names where %s repeats", (_label, raw, issue) => {
    // Act & Assert
    expect(issuesOf(raw)).toEqual([issue]);
  });
});

describe("storedCampusBanners", () => {
  /** A `datasets` document as scripts/lib/datasets/store.js writes it, with revision 1 of the banners as its data. */
  function storedDocument(): Record<string, unknown> {
    return { _id: "campus-banners", revision: 2, data: revisionOne(), updatedAt: new Date("2026-10-19T03:00:00.000Z"), updatedBy: "alice@example.com" };
  }

  it("parses a stored campus-banners document", () => {
    // Act
    const parsed = storedCampusBanners.safeParse(storedDocument());

    // Assert
    expect(parsed.success).toBe(true);
    expect(parsed.data?.revision).toBe(2);
  });

  it.each(["revision", "data"])("refuses a stored document without its %s", (field) => {
    // Arrange
    const rest = storedDocument();
    delete rest[field];

    // Act & Assert
    expect(storedCampusBanners.safeParse(rest).success).toBe(false);
  });

  it.each([0, -1, 1.5, "3"])("refuses a revision of %p", (revision) => {
    // Act & Assert
    expect(storedCampusBanners.safeParse({ ...storedDocument(), revision }).success).toBe(false);
  });

  it("refuses stored data the carousel schema refuses", () => {
    // Arrange
    const stored = storedDocument();
    const data = { ...(stored.data as Record<string, unknown>), extra: 1 };

    // Act & Assert
    expect(storedCampusBanners.safeParse({ ...stored, data }).success).toBe(false);
  });
});
