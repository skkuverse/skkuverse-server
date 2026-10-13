/**
 * The campus sheet's banner carousel as loaded: the boot-time check
 * (loadCampusBanners) and the committed campus-banners.json, resolved per
 * request.
 *
 * The check shares its carousel rules with the home layout
 * (ui-home.config.spec.ts covers those one by one), so this file pins what
 * differs for campus.
 */
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";
import { MiniAppsService } from "../../miniapps/miniapps.service";
import { loadCampusBanners as loadWithRegistry, readCampusBanners } from "./ui-campus.config";
import { toCampusSheet } from "./ui-campus.mapper";
import type { CampusBannerCarouselRaw } from "./ui-campus.schema";

const registry = new MiniAppsService();
const committedBanners = readCampusBanners(registry);

const loadCampusBanners = (raw: unknown): Readonly<CampusBannerCarouselRaw> => loadWithRegistry(raw, registry);

function getCampusSections(lang: SupportedLang, now: Date) {
  return toCampusSheet({ banners: committedBanners, lang, now, webviewOrigin: WEBVIEW_ORIGIN });
}

const IMAGE_URL = "https://media.skkuverse.com/campus/banners/test-00000000.webp";

function image(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "image", id: "banner-a", imageUrl: IMAGE_URL, alt: { ko: "현수막" }, ...overrides };
}

function carousel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "banner_carousel",
    id: "campus_banners",
    aspectRatio: 6,
    autoRotateSec: 4,
    items: [image()],
    ...overrides,
  };
}

describe("committed campus-banners.json", () => {
  it("loads, so the module import in this file did not throw", () => {
    // Act
    const [first] = getCampusSections("ko", new Date("2026-10-02T12:00:00+09:00")).sections;

    // Assert
    expect(first).toMatchObject({ type: "banner_carousel", id: "campus_banners" });
  });

  it("closes every ESKARA 2026 banner when the festival ends", () => {
    // Arrange
    const types = (iso: string) =>
      getCampusSections("ko", new Date(iso)).sections.map((s) => s.type);

    // Act & Assert
    expect(types("2026-10-02T23:59:59+09:00")).toEqual(["banner_carousel", "button_grid"]);
    expect(types("2026-10-03T00:00:00+09:00")).toEqual(["button_grid"]);
  });
});

describe("assertValidCampusCarousel (via loadCampusBanners)", () => {
  it("accepts a 6:1 image-only carousel", () => {
    // Act & Assert
    expect(() => loadCampusBanners(carousel())).not.toThrow();
  });

  it.each<[string, unknown]>([
    ["a non-object root", []],
    ["a section type other than banner_carousel", carousel({ type: "tile_grid" })],
    ["a missing id", carousel({ id: undefined })],
    ["the home default item", carousel({ items: [image(), { type: "default" }] })],
    ["a banner id equal to the carousel id", carousel({ items: [image({ id: "campus_banners" })] })],
    ["an aspect ratio above 6", carousel({ aspectRatio: 7 })],
    ["an image off the media bucket", carousel({ items: [image({ imageUrl: "https://evil.com/a.webp" })] })],
    ["an empty items list", carousel({ items: [] })],
  ])("rejects %s", (_label, raw) => {
    // Act & Assert
    expect(() => loadCampusBanners(raw)).toThrow(/^campus banners: /);
  });

  it("names the path of a broken banner action", () => {
    // Arrange
    const raw = carousel({ items: [image(), image({ id: "b", actionType: "external", actionValue: "/x" })] });

    // Act & Assert
    expect(() => loadCampusBanners(raw)).toThrow(/^campus banners: items\.1\.actionValue: "b" actionValue "\/x" is not valid for "external"$/);
  });
});
