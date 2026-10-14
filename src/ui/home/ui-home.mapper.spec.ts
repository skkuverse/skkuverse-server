/**
 * toHomeLayout resolves the checked layout for one request: a banner shows only
 * inside its window, an emptied carousel stays, text is in the request language
 * with ko behind it, a media icon becomes a uri, and nothing kept only on disk
 * (a window, the untranslated text) reaches the wire.
 */
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";
import { MiniAppsService } from "../../miniapps/miniapps.service";
import { loadHomeLayout } from "./ui-home.config";
import { toHomeLayout } from "./ui-home.mapper";
import type { HomeLayoutRaw } from "./ui-home.schema";

const registry = new MiniAppsService();

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

describe("toHomeLayout", () => {
  const WINDOW = {
    startAt: "2026-10-01T00:00:00+09:00",
    endAt: "2026-10-03T00:00:00+09:00",
  };

  function resolveAt(iso: string, raw: Record<string, unknown>, lang: SupportedLang = "ko") {
    const loaded = loadHomeLayout(raw, registry) as HomeLayoutRaw;
    return toHomeLayout(loaded, { lang, now: new Date(iso), resolveLogo: (logo) => registry.resolveLogo(logo) });
  }

  it("shows a windowed banner only inside [startAt, endAt)", () => {
    // Arrange
    const raw = layout(carousel({ items: [image(WINDOW), { type: "default" }] }));
    const ids = (iso: string) =>
      (resolveAt(iso, raw).sections[0] as { items: { type: string }[] }).items.map((i) => i.type);

    // Act & Assert
    expect(ids("2026-09-30T23:59:59+09:00")).toEqual(["default"]);
    expect(ids("2026-10-01T00:00:00+09:00")).toEqual(["image", "default"]);
    expect(ids("2026-10-03T00:00:00+09:00")).toEqual(["default"]);
  });

  it("keeps a carousel whose every image has expired, with no items", () => {
    // Arrange
    const raw = layout(carousel({ items: [image(WINDOW)] }));

    // Act & Assert
    expect(resolveAt("2026-10-05T00:00:00+09:00", raw).sections[0]).toMatchObject({
      type: "banner_carousel",
      items: [],
    });
  });

  it("resolves text to the request language, falling back to ko", () => {
    // Arrange
    const raw = layout(carousel(), grid({ title: { ko: "미니게임", en: "Mini games" } }));

    // Act
    const en = resolveAt("2026-09-25T00:00:00Z", raw, "en");
    const zh = resolveAt("2026-09-25T00:00:00Z", raw, "zh");

    // Assert
    expect(en.sections[1]).toMatchObject({ title: "Mini games" });
    expect((en.sections[0] as { items: { alt?: string }[] }).items[0]?.alt).toBe("Banner");
    expect(zh.sections[1]).toMatchObject({ title: "Mini games" });
  });

  it("ships no on-disk-only field", () => {
    // Arrange
    const raw = layout(carousel({ items: [image(WINDOW)] }), grid());

    // Act
    const wire = resolveAt("2026-10-01T12:00:00+09:00", raw);

    // Assert
    expect(wire.sections[0]).toEqual({
      type: "banner_carousel",
      id: "home_top",
      aspectRatio: 2.25,
      autoRotateSec: 5,
      items: [
        {
          type: "image",
          id: "banner-a",
          imageUrl: IMAGE_URL,
          alt: "배너",
          actionType: "miniapp",
          actionValue: "eskara-2026",
        },
      ],
    });
    expect(wire.sections[1]).toEqual({
      type: "tile_grid",
      id: "main",
      tiles: [{ kind: "miniapp", id: "mukja" }],
    });
  });

  it("resolves a link tile's title to the request language and its media icon to a uri", () => {
    // Arrange
    const raw = layout(
      tiles(
        { kind: "game", id: "wave-run" },
        link({ icon: { kind: "media", url: IMAGE_URL } }),
      ),
    );

    // Act & Assert
    expect(resolveAt("2026-09-25T00:00:00Z", raw, "en").sections[0]).toEqual({
      type: "tile_grid",
      id: "main",
      tiles: [
        { kind: "game", id: "wave-run" },
        {
          kind: "link",
          id: "campus-map",
          title: "Campus map",
          icon: { kind: "remote", uri: IMAGE_URL },
          actionType: "route",
          actionValue: "/(tabs)/campus",
        },
      ],
    });
  });

  it("serves a root-relative web view tile on the web view origin", () => {
    // Arrange
    const raw = layout(tiles(link({ actionType: "webview", actionValue: "/skku/lostandfound" })));

    // Act
    const [section] = resolveAt("2026-09-25T00:00:00Z", raw, "ko").sections;

    // Assert
    expect(section?.type === "tile_grid" ? section.tiles[0] : null).toMatchObject({
      actionType: "webview",
      actionValue: `${WEBVIEW_ORIGIN}/skku/lostandfound`,
    });
  });
});
