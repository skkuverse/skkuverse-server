/**
 * The home layout as loaded: the boot-time check (loadHomeLayout: the structure
 * in ui-home.schema.ts plus the registry references) and the committed
 * home-layout.json, resolved per request.
 *
 * The check runs against OUR OWN config, so each rejection here is a deploy
 * that must not start. Mini-app ids are checked against the real registry.
 */
import { Clock } from "../../infra/clock";
import type { SupportedLang } from "../../infra/types";
import { MiniAppsService } from "../../miniapps/miniapps.service";
import { UiCampusService } from "../campus/ui-campus.service";
import { loadHomeLayout as loadWithRegistry, readHomeLayout } from "./ui-home.config";
import { toHomeLayout } from "./ui-home.mapper";
import type { HomeLayoutRaw } from "./ui-home.schema";

const registry = new MiniAppsService();
const committedLayout = readHomeLayout(registry);
const campus = new UiCampusService(registry, new Clock());

const loadHomeLayout = (raw: unknown): Readonly<HomeLayoutRaw> => loadWithRegistry(raw, registry);

function resolveHomeLayout(lang: SupportedLang, now: Date, source: Readonly<HomeLayoutRaw> = committedLayout) {
  return toHomeLayout(source, { lang, now, resolveLogo: (logo) => registry.resolveLogo(logo) });
}

function getCampusSections(lang: SupportedLang) {
  return campus.getCampusSheet(lang);
}

const IMAGE_URL = "https://media.skkuverse.com/home/banners/test-00000000.jpg";

function image(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function carousel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "banner_carousel",
    id: "home_top",
    aspectRatio: 2.25,
    autoRotateSec: 5,
    items: [image(), { type: "default" }],
    ...overrides,
  };
}

function grid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "tile_grid", id: "main", tiles: [{ kind: "miniapp", id: "mukja" }], ...overrides };
}

function link(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

const tiles = (...list: Record<string, unknown>[]) => grid({ tiles: list });

function layout(...sections: Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, sections };
}

describe("committed home-layout.json", () => {
  it("loads, so the module import in this file did not throw", () => {
    // Act
    const resolved = resolveHomeLayout("ko", new Date());

    // Assert
    expect(resolved.version).toBe(1);
    expect(resolved.sections.map((s) => s.type)).toContain("banner_carousel");
  });

  it.each(["ko", "en", "zh"] as const)(
    "home_tiles (%s): the campus sheet's four buttons, then the games, in one grid",
    (lang) => {
      // Act
      const resolved = resolveHomeLayout(lang, new Date());

      // Assert
      // One grid: the app puts a 24 pt gap after each grid, so a second grid
      // for the games would read as a new section (2026-10-09).
      expect(resolved.sections.map((s) => s.id)).toEqual(["home_top", "home_tiles"]);
      const homeRow = resolved.sections.find((s) => s.id === "home_tiles") as unknown as {
        tiles: Array<{ kind: string; id: string; title?: string; actionType?: string; actionValue?: string }>;
      };
      const sheet = getCampusSections(lang).sections.find((s) => s.type === "button_grid") as {
        items: Array<{ id: string; title: string; actionType: string; actionValue: string }>;
      };
      // The four service tiles mean the same thing as the campus sheet's buttons.
      expect(
        homeRow.tiles.slice(0, 4).map(({ kind, id, title, actionType, actionValue }) => ({ kind, id, title, actionType, actionValue })),
      ).toEqual(sheet.items.map(({ id, title, actionType, actionValue }) => ({ kind: "link", id, title, actionType, actionValue })));
      expect(homeRow.tiles.slice(4)).toEqual([
        { kind: "game", id: "subway-typing" },
        { kind: "game", id: "wave-run" },
      ]);
    },
  );
});

describe("assertValidHomeLayout (via loadHomeLayout)", () => {
  it("accepts a well-formed layout", () => {
    // Act & Assert
    expect(() => loadHomeLayout(layout(carousel(), grid()))).not.toThrow();
  });

  it("accepts every tile kind in one grid", () => {
    // Arrange
    const mixed = tiles(
      { kind: "game", id: "wave-run" },
      { kind: "miniapp", id: "mukja" },
      link(),
      link({ id: "notice", icon: { kind: "media", url: IMAGE_URL }, actionType: "miniapp", actionValue: "inja" }),
    );

    // Act & Assert
    expect(() => loadHomeLayout(layout(mixed))).not.toThrow();
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown root key", { ...layout(), extra: 1 }],
    ["a version other than 1", { version: 2, sections: [] }],
    ["an unknown section type", layout({ type: "hero", id: "x" })],
    ["a duplicate id across sections and banners", layout(carousel(), grid({ id: "banner-a" }))],
    ["an unknown carousel key", layout(carousel({ autoRotate: 5 }))],
    ["an aspect ratio below 1", layout(carousel({ aspectRatio: 0.5 }))],
    ["an aspect ratio given as a string", layout(carousel({ aspectRatio: "2.25" }))],
    ["a rotation of 1 second", layout(carousel({ autoRotateSec: 1 }))],
    ["a fractional rotation", layout(carousel({ autoRotateSec: 4.5 }))],
    ["an empty items list", layout(carousel({ items: [] }))],
    ["the default placed twice", layout(carousel({ items: [{ type: "default" }, { type: "default" }] }))],
    ["a key on the default item", layout(carousel({ items: [{ type: "default", id: "x" }] }))],
    ["an image off the media bucket", layout(carousel({ items: [image({ imageUrl: "https://evil.com/a.jpg" })] }))],
    ["an image with no ko alt", layout(carousel({ items: [image({ alt: { en: "Banner" } })] }))],
    ["an actionType without an actionValue", layout(carousel({ items: [image({ actionValue: undefined })] }))],
    ["an unregistered miniapp action", layout(carousel({ items: [image({ actionValue: "nope" })] }))],
    ["a relative external action", layout(carousel({ items: [image({ actionType: "external", actionValue: "/x" })] }))],
    ["an unknown action type", layout(carousel({ items: [image({ actionType: "map" })] }))],
    ["a window with no offset", layout(carousel({ items: [image({ endAt: "2026-10-03T00:00:00" })] }))],
    [
      "a window that ends before it starts",
      layout(carousel({ items: [image({ startAt: "2026-10-03T00:00:00+09:00", endAt: "2026-10-01T00:00:00+09:00" })] })),
    ],
    ["an unregistered mini app in a grid", layout(tiles({ kind: "miniapp", id: "nope" }))],
    ["an empty grid", layout(grid({ tiles: [] }))],
    ["the old miniAppIds key", layout(grid({ tiles: undefined, miniAppIds: ["mukja"] }))],
    ["one mini app in two grids", layout(grid(), grid({ id: "games" }))],
    ["one tile id under two kinds", layout(tiles({ kind: "miniapp", id: "mukja" }, link({ id: "mukja" })))],
    ["an unknown tile kind", layout(tiles({ kind: "screen", id: "campus" }))],
    ["a game id that is not a slug", layout(tiles({ kind: "game", id: "Wave Run" }))],
    ["an extra key on an id tile", layout(tiles({ kind: "game", id: "wave-run", title: { ko: "파도" } }))],
    ["a link with no title", layout(tiles(link({ title: undefined })))],
    ["a link with no action", layout(tiles(link({ actionType: undefined, actionValue: undefined })))],
    ["a link with a relative route", layout(tiles(link({ actionValue: "campus" })))],
    ["a link icon of two emoji", layout(tiles(link({ icon: { kind: "emoji", emoji: "🗺️🗺️" } })))],
    ["a link icon off the media bucket", layout(tiles(link({ icon: { kind: "media", url: "https://evil.com/a.png" } })))],
    ["a link icon in the registry's legacy path spelling", layout(tiles(link({ icon: { kind: "remote", path: "/a.png" } })))],
    ["a blank title", layout(grid({ title: { ko: " " } }))],
  ])("rejects %s", (_label, raw) => {
    // Act & Assert
    expect(() => loadHomeLayout(raw)).toThrow(/^home layout: /);
  });
});

describe("miniapp_feed section", () => {
  function feed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "miniapp_feed",
      id: "eskara_feed",
      miniAppId: "eskara-2026",
      title: { ko: "에스카라 실시간 소식", en: "ESKARA live" },
      limit: 3,
      ...overrides,
    };
  }

  it("accepts a well-formed feed section", () => {
    // Act & Assert
    expect(() => loadHomeLayout(layout(carousel(), feed(), grid()))).not.toThrow();
  });

  it("accepts one with no title and no limit", () => {
    // Act & Assert
    expect(() =>
      loadHomeLayout(layout(feed({ title: undefined, limit: undefined }))),
    ).not.toThrow();
  });

  it("rejects a mini app the registry does not know", () => {
    // Act & Assert
    expect(() => loadHomeLayout(layout(feed({ miniAppId: "no-such-app" })))).toThrow(
      /not a registered mini app/,
    );
  });

  it("rejects an unknown key, so a misspelling cannot pass boot and do nothing", () => {
    // Act & Assert
    expect(() => loadHomeLayout(layout(feed({ limt: 3 })))).toThrow(/limt/);
  });

  it.each([0, 11, 2.5, "3"])("rejects limit %p", (limit) => {
    // Act & Assert
    expect(() => loadHomeLayout(layout(feed({ limit })))).toThrow(/limit/);
  });

  it("shares the section id namespace", () => {
    // Act & Assert
    expect(() => loadHomeLayout(layout(carousel(), feed({ id: "home_top" })))).toThrow(
      /duplicate id/,
    );
  });

  it("resolves to the wire shape with the title in the request language and a default limit", () => {
    // Arrange
    const source = loadHomeLayout(
      layout(feed(), feed({ id: "bare", title: undefined, limit: undefined })),
    );

    // Act
    const { sections } = resolveHomeLayout("en", new Date(), source);

    // Assert
    expect(sections).toEqual([
      { type: "miniapp_feed", id: "eskara_feed", miniAppId: "eskara-2026", title: "ESKARA live", limit: 3 },
      { type: "miniapp_feed", id: "bare", miniAppId: "eskara-2026", limit: 3 },
    ]);
  });
});
