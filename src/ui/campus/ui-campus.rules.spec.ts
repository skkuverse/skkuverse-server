/**
 * The checks a campus carousel needs beyond its schema, as pure functions
 * (move-editorial-datasets D4): `npm run data` refuses a push on any issue,
 * and the reader leaves out each banner an issue points into.
 *
 * - toCampusBannerIssues finds every banner whose action value fails its
 *   type's check against the mini app registry, an unregistered `miniapp`
 *   target included, at the banner's `actionValue` path.
 * - campusBannerReferences lists one `miniapps` reference per `miniapp`
 *   action, by the id its target names, so the tool resolves it.
 * - withoutUnresolvedBanners drops exactly the banners an issue points into.
 *
 * Revision 1 of the dataset (fixtures/campus-banners.dataset.json) has no
 * issue and names no mini app.
 */
import fs from "fs";
import path from "path";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { campusBannerReferences, toCampusBannerIssues, withoutUnresolvedBanners } from "./ui-campus.rules";
import { campusBannersFile, type CampusBannerCarouselRaw } from "./ui-campus.schema";

const registry = new MiniappsService();

const IMAGE_URL = "https://media.skkuverse.com/campus/banners/test-00000000.webp";

function image(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "image", id: "banner-a", imageUrl: IMAGE_URL, alt: { ko: "현수막" }, ...overrides };
}

function carousel(...items: Array<Record<string, unknown>>): CampusBannerCarouselRaw {
  return campusBannersFile.parse({ type: "banner_carousel", id: "campus_banners", aspectRatio: 6, autoRotateSec: 4, items });
}

function fixtureBanners(): CampusBannerCarouselRaw {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/ui/fixtures/campus-banners.dataset.json"), "utf8")) as Record<string, unknown>;
  delete fixture._about;
  return campusBannersFile.parse(fixture);
}

describe("toCampusBannerIssues", () => {
  it.each<[string, string]>([
    ["miniapp", "no-such-app"],
    ["miniapp", "inja:relative"],
    ["external", "http://example.com"],
    ["webview", "https://example.com/page"],
    ["route", "taxi"],
  ])("finds a broken %s action value %p at the banner's actionValue path", (actionType, actionValue) => {
    // Arrange
    const banners = carousel(image(), image({ id: "b", actionType, actionValue }));

    // Act
    const issues = toCampusBannerIssues(banners, registry);

    // Assert
    expect(issues).toEqual([{ path: ["items", 1, "actionValue"], message: `"b" actionValue "${actionValue}" is not valid for "${actionType}"` }]);
  });

  it.each<[string, string]>([
    ["miniapp", "inja"],
    ["miniapp", "inja/entry"],
    ["external", "https://example.com"],
    ["webview", "/skku/lostandfound"],
    ["route", "/map/hssc"],
  ])("finds no issue in a valid %s action value %p", (actionType, actionValue) => {
    // Arrange
    const banners = carousel(image({ actionType, actionValue }));

    // Act & Assert
    expect(toCampusBannerIssues(banners, registry)).toEqual([]);
  });

  it("finds an unregistered mini app target, naming its id", () => {
    // Arrange
    const banners = carousel(image({ actionType: "miniapp", actionValue: "removed-by-a-deploy/entry" }));

    // Act
    const [issue] = toCampusBannerIssues(banners, registry);

    // Assert
    expect(issue?.path).toEqual(["items", 0, "actionValue"]);
    expect(issue?.message).toContain("removed-by-a-deploy");
  });

  it("finds every broken banner, not only the first", () => {
    // Arrange
    const banners = carousel(image({ actionType: "route", actionValue: "x" }), image({ id: "b", actionType: "miniapp", actionValue: "nope" }));

    // Act & Assert
    expect(toCampusBannerIssues(banners, registry).map((issue) => issue.path)).toEqual([
      ["items", 0, "actionValue"],
      ["items", 1, "actionValue"],
    ]);
  });

  it("finds no issue in revision 1 of the dataset", () => {
    // Act & Assert
    expect(toCampusBannerIssues(fixtureBanners(), registry)).toEqual([]);
  });
});

describe("campusBannerReferences", () => {
  it("lists one miniapps reference per miniapp action, by the id its target names, at its actionValue path", () => {
    // Arrange
    const banners = carousel(
      image({ id: "a", actionType: "miniapp", actionValue: "inja/entry" }),
      image({ id: "b", actionType: "route", actionValue: "/map/hssc" }),
      image({ id: "c" }),
      image({ id: "d", actionType: "miniapp", actionValue: "eskara-2026" }),
    );

    // Act
    const references = campusBannerReferences(banners, registry);

    // Assert
    expect(references).toEqual([
      { dataset: "miniapps", id: "inja", path: ["items", 0, "actionValue"] },
      { dataset: "miniapps", id: "eskara-2026", path: ["items", 3, "actionValue"] },
    ]);
  });

  it("lists an unregistered target too, so the tool can name it", () => {
    // Arrange
    const banners = carousel(image({ actionType: "miniapp", actionValue: "nope" }));

    // Act & Assert
    expect(campusBannerReferences(banners, registry)).toEqual([{ dataset: "miniapps", id: "nope", path: ["items", 0, "actionValue"] }]);
  });

  it("lists no reference for a target that does not parse", () => {
    // Arrange
    const banners = carousel(image({ actionType: "miniapp", actionValue: "inja:relative" }));

    // Act & Assert
    expect(campusBannerReferences(banners, registry)).toEqual([]);
  });

  it("lists no reference in revision 1 of the dataset", () => {
    // Act & Assert
    expect(campusBannerReferences(fixtureBanners(), registry)).toEqual([]);
  });
});

describe("withoutUnresolvedBanners", () => {
  const banners = carousel(image({ id: "a" }), image({ id: "b" }), image({ id: "c" }));

  it("drops exactly the banners an issue points into, keeping the rest in order", () => {
    // Arrange
    const issues = [{ path: ["items", 1, "actionValue"], message: "broken" }];

    // Act
    const kept = withoutUnresolvedBanners(banners, issues);

    // Assert
    expect(kept.items.map((banner) => banner.id)).toEqual(["a", "c"]);
    expect({ ...kept, items: undefined }).toEqual({ ...banners, items: undefined });
  });

  it("keeps every banner when there is no issue", () => {
    // Act & Assert
    expect(withoutUnresolvedBanners(banners, [])).toEqual(banners);
  });

  it("drops every banner when each has an issue, leaving an empty carousel", () => {
    // Arrange
    const issues = [0, 1, 2].map((index) => ({ path: ["items", index, "actionValue"], message: "broken" }));

    // Act & Assert
    expect(withoutUnresolvedBanners(banners, issues).items).toEqual([]);
  });

  it("throws on an issue that names no banner, a fault in its caller", () => {
    // Act & Assert
    expect(() => withoutUnresolvedBanners(banners, [{ path: ["id"], message: "x" }])).toThrow("names no banner");
  });
});
