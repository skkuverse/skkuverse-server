/**
 * The structure of campus-banners.json: the committed file parses, a copy
 * missing any carousel field does not, and the carousel id and its banner ids
 * are one namespace.
 */
import fs from "fs";
import path from "path";
import { campusBannersFile } from "./ui-campus.schema";

const COMMITTED = JSON.parse(fs.readFileSync(path.join(__dirname, "campus-banners.json"), "utf8")) as Record<
  string,
  unknown
>;

describe("campusBannersFile", () => {
  it("parses the committed campus-banners.json", () => {
    // Act & Assert
    expect(campusBannersFile.safeParse(COMMITTED).success).toBe(true);
  });

  it.each(Object.keys(campusBannersFile.shape))("refuses a carousel without its %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...COMMITTED };
    delete rest[field];

    // Act & Assert
    expect(campusBannersFile.safeParse(rest).success).toBe(false);
  });

  it("refuses two banners with one id", () => {
    // Arrange
    const [first] = COMMITTED.items as Record<string, unknown>[];
    const twice = { ...COMMITTED, items: [first, first] };

    // Act & Assert
    expect(campusBannersFile.safeParse(twice).success).toBe(false);
  });
});

describe("campusBannersFile, on the carousels the boot check refused", () => {
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
