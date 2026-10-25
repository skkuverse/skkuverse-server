/**
 * The carousel as served: text in the request language with en and then ko
 * behind it, the default item kept where it sits, a closed image dropped, an
 * image's action sent only when it has one, and nothing kept only on disk (the
 * window, the untranslated alt) on the wire.
 */
import { WEBVIEW_ORIGIN } from "../shared/webview-origin.constants";
import { toBannerCarousel, toLocalizedText } from "./ui.mapper";
import type { BannerImageRaw } from "./ui.schema";
import { bannerCarousel } from "./ui.wire";

const IMAGE_URL = "https://media.skkuverse.com/campus/banners/test-00000000.webp";

function image(overrides: Partial<BannerImageRaw> = {}): BannerImageRaw {
  return { type: "image", id: "banner-a", imageUrl: IMAGE_URL, alt: { ko: "현수막", en: "Banner" }, ...overrides };
}

const carousel = (items: Array<BannerImageRaw | { type: "default" }>) => ({
  type: "banner_carousel" as const,
  id: "campus_banners",
  aspectRatio: 6,
  autoRotateSec: 4,
  items,
});

describe("toLocalizedText", () => {
  it.each([
    ["ko", "한국어"],
    ["en", "English"],
    ["zh", "中文"],
  ] as const)("picks %s when it is there", (lang, expected) => {
    // Act & Assert
    expect(toLocalizedText({ ko: "한국어", en: "English", zh: "中文" }, lang)).toBe(expected);
  });

  it("falls back to en, then ko", () => {
    // Act & Assert
    expect(toLocalizedText({ ko: "한국어", en: "English" }, "zh")).toBe("English");
    expect(toLocalizedText({ ko: "한국어" }, "zh")).toBe("한국어");
  });
});

describe("toBannerCarousel", () => {
  const now = new Date("2026-10-02T00:00:00Z");

  it("keeps the default item in place, drops a closed image and sends an action only when there is one", () => {
    // Arrange
    const raw = carousel([
      image({ id: "closed", endAt: "2026-10-01T00:00:00+09:00" }),
      { type: "default" },
      image({ actionType: "miniapp", actionValue: "eskara-2026", startAt: "2026-10-01T00:00:00+09:00" }),
      image({ id: "plain" }),
    ]);

    // Act
    const served = toBannerCarousel(raw, "en", now);

    // Assert
    expect(served).toEqual({
      type: "banner_carousel",
      id: "campus_banners",
      aspectRatio: 6,
      autoRotateSec: 4,
      items: [
        { type: "default" },
        {
          type: "image",
          id: "banner-a",
          imageUrl: IMAGE_URL,
          alt: "Banner",
          actionType: "miniapp",
          actionValue: "eskara-2026",
        },
        { type: "image", id: "plain", imageUrl: IMAGE_URL, alt: "Banner" },
      ],
    });
    expect(bannerCarousel.safeParse(served).success).toBe(true);
  });

  it("serves a root-relative web view link on the web view origin, as the event map serves its buttons", () => {
    // Arrange
    const raw = carousel([
      image({ id: "relative", actionType: "webview", actionValue: "/skku/lostandfound" }),
      image({ id: "absolute", actionType: "webview", actionValue: `${WEBVIEW_ORIGIN}/skku/lostandfound` }),
      image({ id: "route", actionType: "route", actionValue: "/map/hssc" }),
    ]);

    // Act
    const served = toBannerCarousel(raw, "ko", now);

    // Assert
    expect(served.items.map((item) => (item.type === "image" ? item.actionValue : null))).toEqual([
      `${WEBVIEW_ORIGIN}/skku/lostandfound`,
      `${WEBVIEW_ORIGIN}/skku/lostandfound`,
      "/map/hssc",
    ]);
  });

  it("serves an empty carousel when every image has closed", () => {
    // Arrange
    const raw = carousel([image({ endAt: "2026-10-01T00:00:00+09:00" })]);

    // Act
    const served = toBannerCarousel(raw, "ko", now);

    // Assert
    expect(served.items).toEqual([]);
  });
});
