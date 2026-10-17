/**
 * toCampusSheet serves the resolved banner carousel as the sheet's only
 * section, and drops it once every banner is outside its window: the campus
 * sheet has no default banner to draw in an empty slot, and its service
 * buttons moved to the map's chip row.
 */
import { MiniappsService } from "../../miniapps/miniapps.service";
import { loadCampusBanners } from "./ui-campus.config";
import { toCampusSheet } from "./ui-campus.mapper";
import type { CampusBannerCarouselRaw } from "./ui-campus.schema";

const registry = new MiniappsService();

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

describe("toCampusSheet", () => {
  const WINDOW = { startAt: "2026-10-01T00:00:00+09:00", endAt: "2026-10-03T00:00:00+09:00" };

  function sectionsAt(iso: string, raw: Record<string, unknown>) {
    const banners = loadCampusBanners(raw, registry) as CampusBannerCarouselRaw;
    return toCampusSheet({ banners, lang: "ko", now: new Date(iso) }).sections;
  }

  it("serves the carousel as the only section, in wire shape", () => {
    // Act
    const sections = sectionsAt("2026-10-02T00:00:00+09:00", carousel({ items: [image(WINDOW)] }));

    // Assert
    expect(sections.map((s) => s.type)).toEqual(["banner_carousel"]);
    expect(sections[0]).toEqual({
      type: "banner_carousel",
      id: "campus_banners",
      aspectRatio: 6,
      autoRotateSec: 4,
      items: [{ type: "image", id: "banner-a", imageUrl: IMAGE_URL, alt: "현수막" }],
    });
  });

  it("drops the carousel once every banner is outside its window", () => {
    // Act
    const sections = sectionsAt("2026-10-03T00:00:00+09:00", carousel({ items: [image(WINDOW)] }));

    // Assert
    expect(sections).toEqual([]);
  });
});
