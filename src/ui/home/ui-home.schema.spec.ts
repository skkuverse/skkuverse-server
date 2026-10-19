/**
 * The structure of home-layout.json: the committed file parses, a copy missing
 * either top-level field does not, a feed section without a limit gets the
 * default one, and ids repeat neither across sections and banners nor across
 * tiles.
 *
 * And the stored `home-layout` dataset as the repository reads it: a document
 * `npm run data` stored passes, and one missing its revision or its data does not.
 */
import fs from "fs";
import path from "path";
import { DEFAULT_MINIAPP_FEED_LIMIT } from "./ui-home.constants";
import { homeLayoutFile, storedHomeLayout } from "./ui-home.schema";

const COMMITTED = JSON.parse(fs.readFileSync(path.join(__dirname, "home-layout.json"), "utf8")) as Record<string, unknown>;

const feed = { type: "miniapp_feed", id: "eskara_feed", miniAppId: "eskara-2026" };
const grid = (id: string, tileId: string) => ({ type: "tile_grid", id, tiles: [{ kind: "game", id: tileId }] });

describe("homeLayoutFile", () => {
  it("parses the committed home-layout.json", () => {
    // Act & Assert
    expect(homeLayoutFile.safeParse(COMMITTED).success).toBe(true);
  });

  it.each(Object.keys(homeLayoutFile.shape))("refuses a layout without its %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...COMMITTED };
    delete rest[field];

    // Act & Assert
    expect(homeLayoutFile.safeParse(rest).success).toBe(false);
  });

  it("gives a feed section without a limit the default one", () => {
    // Act
    const parsed = homeLayoutFile.parse({ version: 1, sections: [feed] });

    // Assert
    expect(parsed.sections[0]).toMatchObject({ limit: DEFAULT_MINIAPP_FEED_LIMIT });
  });

  it("refuses a section id used twice and a tile placed twice, and accepts each once", () => {
    // Act & Assert
    expect(homeLayoutFile.safeParse({ version: 1, sections: [grid("a", "x"), grid("b", "y")] }).success).toBe(true);
    expect(homeLayoutFile.safeParse({ version: 1, sections: [grid("a", "x"), grid("a", "y")] }).success).toBe(false);
    expect(homeLayoutFile.safeParse({ version: 1, sections: [grid("a", "x"), grid("b", "x")] }).success).toBe(false);
  });
});

const IMAGE_URL = "https://media.skkuverse.com/home/banners/test-00000000.jpg";

function bannerImage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "image",
    id: "banner-a",
    imageUrl: IMAGE_URL,
    alt: { ko: "배너", en: "Banner" },
    actionType: "miniapp",
    actionValue: "eskara-2026",
    ...overrides,
  };
}

function bannerCarousel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "banner_carousel", id: "home_top", aspectRatio: 2.25, autoRotateSec: 5, items: [bannerImage(), { type: "default" }], ...overrides };
}

function tileGrid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "tile_grid", id: "main", tiles: [{ kind: "miniapp", id: "mukja" }], ...overrides };
}

function linkTile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "link",
    id: "campus-map",
    title: { ko: "캠퍼스 지도", en: "Campus map" },
    icon: { kind: "emoji", emoji: "🗺️" },
    actionType: "route",
    actionValue: "/(tabs)/campus",
    ...overrides,
  };
}

function feedSection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "miniapp_feed", id: "eskara_feed", miniAppId: "eskara-2026", title: { ko: "에스카라 실시간 소식", en: "ESKARA live" }, limit: 3, ...overrides };
}

const tilesOf = (...list: Record<string, unknown>[]) => tileGrid({ tiles: list });
const layoutOf = (...sections: Record<string, unknown>[]): Record<string, unknown> => ({ version: 1, sections });

/** Each issue as `path: message`, the way a refused push or boot words it. */
function issueLines(raw: unknown): string[] {
  const parsed = homeLayoutFile.safeParse(raw);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("homeLayoutFile refuses each structural mistake the boot check refused", () => {
  it("accepts a well-formed layout, a feed section and every tile kind in one grid", () => {
    // Arrange
    const mixed = tilesOf(
      { kind: "game", id: "wave-run" },
      { kind: "miniapp", id: "mukja" },
      linkTile(),
      linkTile({ id: "notice", icon: { kind: "media", url: IMAGE_URL }, actionType: "miniapp", actionValue: "inja" }),
    );

    // Act & Assert
    expect(issueLines(layoutOf(bannerCarousel(), tileGrid()))).toEqual([]);
    expect(issueLines(layoutOf(bannerCarousel(), feedSection(), tileGrid()))).toEqual([]);
    expect(issueLines(layoutOf(mixed))).toEqual([]);
  });

  it("accepts a feed section with no title and no limit", () => {
    // Act & Assert
    expect(issueLines(layoutOf(feedSection({ title: undefined, limit: undefined })))).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown root key", { ...layoutOf(), extra: 1 }],
    ["a version other than 1", { version: 2, sections: [] }],
    ["an unknown section type", layoutOf({ type: "hero", id: "x" })],
    ["a duplicate id across sections and banners", layoutOf(bannerCarousel(), tileGrid({ id: "banner-a" }))],
    ["an unknown carousel key", layoutOf(bannerCarousel({ autoRotate: 5 }))],
    ["an aspect ratio below 1", layoutOf(bannerCarousel({ aspectRatio: 0.5 }))],
    ["an aspect ratio given as a string", layoutOf(bannerCarousel({ aspectRatio: "2.25" }))],
    ["a rotation of 1 second", layoutOf(bannerCarousel({ autoRotateSec: 1 }))],
    ["a fractional rotation", layoutOf(bannerCarousel({ autoRotateSec: 4.5 }))],
    ["an empty items list", layoutOf(bannerCarousel({ items: [] }))],
    ["the default placed twice", layoutOf(bannerCarousel({ items: [{ type: "default" }, { type: "default" }] }))],
    ["a key on the default item", layoutOf(bannerCarousel({ items: [{ type: "default", id: "x" }] }))],
    ["an image off the media bucket", layoutOf(bannerCarousel({ items: [bannerImage({ imageUrl: "https://evil.com/a.jpg" })] }))],
    ["an image with no ko alt", layoutOf(bannerCarousel({ items: [bannerImage({ alt: { en: "Banner" } })] }))],
    ["an actionType without an actionValue", layoutOf(bannerCarousel({ items: [bannerImage({ actionValue: undefined })] }))],
    ["an unknown action type", layoutOf(bannerCarousel({ items: [bannerImage({ actionType: "map" })] }))],
    ["a window with no offset", layoutOf(bannerCarousel({ items: [bannerImage({ endAt: "2026-10-03T00:00:00" })] }))],
    [
      "a window that ends before it starts",
      layoutOf(bannerCarousel({ items: [bannerImage({ startAt: "2026-10-03T00:00:00+09:00", endAt: "2026-10-01T00:00:00+09:00" })] })),
    ],
    ["an empty grid", layoutOf(tileGrid({ tiles: [] }))],
    ["the old miniAppIds key", layoutOf(tileGrid({ tiles: undefined, miniAppIds: ["mukja"] }))],
    ["one mini app in two grids", layoutOf(tileGrid(), tileGrid({ id: "games" }))],
    ["one tile id under two kinds", layoutOf(tilesOf({ kind: "miniapp", id: "mukja" }, linkTile({ id: "mukja" })))],
    ["an unknown tile kind", layoutOf(tilesOf({ kind: "screen", id: "campus" }))],
    ["a game id that is not a slug", layoutOf(tilesOf({ kind: "game", id: "Wave Run" }))],
    ["an extra key on an id tile", layoutOf(tilesOf({ kind: "game", id: "wave-run", title: { ko: "파도" } }))],
    ["a link with no title", layoutOf(tilesOf(linkTile({ title: undefined })))],
    ["a link with no action", layoutOf(tilesOf(linkTile({ actionType: undefined, actionValue: undefined })))],
    ["a link icon off the media bucket", layoutOf(tilesOf(linkTile({ icon: { kind: "media", url: "https://evil.com/a.png" } })))],
    ["a link icon in the registry's legacy path spelling", layoutOf(tilesOf(linkTile({ icon: { kind: "remote", path: "/a.png" } })))],
    ["a blank title", layoutOf(tileGrid({ title: { ko: " " } }))],
    ["a feed section id shared with a carousel", layoutOf(bannerCarousel(), feedSection({ id: "home_top" }))],
  ])("refuses %s", (_label, raw) => {
    // Act & Assert
    expect(issueLines(raw)).not.toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["a banner id repeated as a section id", layoutOf(bannerCarousel(), tileGrid({ id: "banner-a" })), 'sections.1.id: duplicate id "banner-a"'],
    ["a section id repeated as a banner id", layoutOf(tileGrid({ id: "banner-a" }), bannerCarousel()), 'sections.1.items.0.id: duplicate id "banner-a"'],
    ["a tile placed twice", layoutOf(tileGrid(), tileGrid({ id: "more", tiles: [linkTile(), linkTile()] })), 'sections.1.tiles.1.id: tile "campus-map" is placed more than once'],
    ["a feed section id shared with a carousel", layoutOf(bannerCarousel(), feedSection({ id: "home_top" })), 'sections.1.id: duplicate id "home_top"'],
  ])("names where %s repeats", (_label, raw, issue) => {
    // Act & Assert
    expect(issueLines(raw)).toContain(issue);
  });

  it("refuses an unknown key on a feed section, so a misspelling cannot pass and do nothing", () => {
    // Act & Assert
    expect(issueLines(layoutOf(feedSection({ limt: 3 })))).toEqual([expect.stringMatching(/^sections\.0: .*limt/)]);
  });

  it.each([0, 11, 2.5, "3"])("refuses a feed limit of %p", (limit) => {
    // Act & Assert
    expect(issueLines(layoutOf(feedSection({ limit })))).toEqual([expect.stringMatching(/^sections\.0\.limit: /)]);
  });

  it.each([1, 10])("accepts a feed limit of %p", (limit) => {
    // Act & Assert
    expect(issueLines(layoutOf(feedSection({ limit })))).toEqual([]);
  });
});

// The committed home-layout.json, kept as the fixture the dataset is seeded from.
const DATASET_FIXTURE = path.join(__dirname, "../../../__tests__/nest/ui/fixtures/home-layout.dataset.json");

/** A `datasets` document as scripts/lib/datasets/store.js writes it, with the fixture as its data. */
function storedDocument(): Record<string, unknown> {
  const data = JSON.parse(fs.readFileSync(DATASET_FIXTURE, "utf8")) as Record<string, unknown>;
  delete data._about;
  return { _id: "home-layout", revision: 3, data, updatedAt: new Date("2026-10-19T03:00:00.000Z"), updatedBy: "alice@example.com" };
}

describe("storedHomeLayout", () => {
  it("parses a stored home-layout document", () => {
    // Act
    const parsed = storedHomeLayout.safeParse(storedDocument());

    // Assert
    expect(parsed.success).toBe(true);
    expect(parsed.data?.revision).toBe(3);
  });

  it.each(Object.keys(storedHomeLayout.shape))("refuses a stored document without its %s", (field) => {
    // Arrange
    const rest = storedDocument();
    delete rest[field];

    // Act & Assert
    expect(storedHomeLayout.safeParse(rest).success).toBe(false);
  });

  it.each([0, -1, 1.5, "3"])("refuses a revision of %p", (revision) => {
    // Act & Assert
    expect(storedHomeLayout.safeParse({ ...storedDocument(), revision }).success).toBe(false);
  });

  it("refuses stored data the layout schema refuses", () => {
    // Arrange
    const stored = storedDocument();
    const data = { ...(stored.data as Record<string, unknown>), extra: 1 };

    // Act & Assert
    expect(storedHomeLayout.safeParse({ ...stored, data }).success).toBe(false);
  });
});
