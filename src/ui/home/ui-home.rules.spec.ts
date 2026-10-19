/**
 * The home layout checks a schema cannot hold, because they read the mini app
 * registry: every mini app a tile or feed names is registered, every link
 * action's value is valid for its type (a `miniapp` target by the registry's
 * grammar and ids), and an emoji icon is exactly one emoji. Each issue names
 * its path, so a push can say where and a reader can leave that item out.
 *
 * The registry is the real one: an id the tests treat as registered is in
 * src/miniapps/index.json, and "nope" is not.
 *
 * And the mini apps a layout references, wherever it names one, so a push can
 * refuse a dangling one and a removal can find who still names it. A target is
 * read with the registry's own grammar, so its path is not part of the id.
 *
 * And what a reader serves when a stored layout names a mini app a deploy has
 * removed: the layout without each item an issue points into, an emptied grid
 * left out with it, everything else in its order.
 */
import fs from "fs";
import path from "path";
import { MiniappsService } from "../../miniapps/miniapps.service";
import type { MiniAppRegistry } from "../ui.types";
import { homeLayoutReferences, toHomeLayoutIssues, withoutUnresolvedItems } from "./ui-home.rules";
import { homeLayoutFile } from "./ui-home.schema";

const registry = new MiniappsService();

// A copy of revision 1 of the stored home-layout dataset as of 2026-10-19.
const DATASET_FIXTURE = path.join(__dirname, "../../../__tests__/nest/ui/fixtures/home-layout.dataset.json");

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
  return { type: "banner_carousel", id: "home_top", aspectRatio: 2.25, autoRotateSec: 5, items: [image(), { type: "default" }], ...overrides };
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

function feed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "miniapp_feed", id: "eskara_feed", miniAppId: "eskara-2026", title: { ko: "에스카라 실시간 소식", en: "ESKARA live" }, limit: 3, ...overrides };
}

const tiles = (...list: Record<string, unknown>[]) => grid({ tiles: list });

/** A layout through the schema first, as the checks only ever see a parsed one. */
function layout(...sections: Record<string, unknown>[]) {
  return homeLayoutFile.parse({ version: 1, sections });
}

const banner = (overrides: Record<string, unknown>) => layout(carousel({ items: [{ type: "default" }, image(overrides)] }));
const linkTile = (overrides: Record<string, unknown>) => layout(tiles({ kind: "game", id: "wave-run" }, link(overrides)));

describe("toHomeLayoutIssues", () => {
  it("finds no issue in revision 1 of the stored layout", () => {
    // Arrange
    const stored = JSON.parse(fs.readFileSync(DATASET_FIXTURE, "utf8")) as Record<string, unknown>;
    delete stored._about;

    // Act & Assert
    expect(toHomeLayoutIssues(homeLayoutFile.parse(stored), registry)).toEqual([]);
  });

  it.each([
    ["a well-formed layout", () => layout(carousel(), grid())],
    [
      "every tile kind in one grid",
      () =>
        layout(
          tiles(
            { kind: "game", id: "wave-run" },
            { kind: "miniapp", id: "mukja" },
            link(),
            link({ id: "notice", icon: { kind: "media", url: IMAGE_URL }, actionType: "miniapp", actionValue: "inja" }),
          ),
        ),
    ],
    ["a well-formed feed section between others", () => layout(carousel(), feed(), grid())],
    ["a banner with no action", () => banner({ actionType: undefined, actionValue: undefined })],
  ])("finds no issue in %s", (_label, build) => {
    // Act & Assert
    expect(toHomeLayoutIssues(build(), registry)).toEqual([]);
  });

  it.each([
    ["a registered mini app", "eskara-2026"],
    ["a registered mini app with a path", "eskara-2026/eskara/wristband"],
    ["a registered mini app at its root path", "hssc/"],
  ])("accepts a miniapp target of %s", (_label, actionValue) => {
    // Act & Assert
    expect(toHomeLayoutIssues(banner({ actionValue }), registry)).toEqual([]);
    expect(toHomeLayoutIssues(linkTile({ actionType: "miniapp", actionValue }), registry)).toEqual([]);
  });

  it.each([
    ["external", "https://pf.kakao.com/_cjxexdG/chat"],
    ["webview", "/skku/lostandfound"],
    ["webview", "https://webview.skkuverse.com/skku/lostandfound"],
    ["route", "/map/hssc"],
  ])("accepts a %s action of %s", (actionType, actionValue) => {
    // Act & Assert
    expect(toHomeLayoutIssues(banner({ actionType, actionValue }), registry)).toEqual([]);
    expect(toHomeLayoutIssues(linkTile({ actionType, actionValue }), registry)).toEqual([]);
  });

  it.each([
    ["an unregistered mini app tile", () => layout(grid(), grid({ id: "more", tiles: [{ kind: "miniapp", id: "nope" }] })), ["sections", 1, "tiles", 0, "id"], '"nope" is not a registered mini app'],
    ["an unregistered mini app in a grid", () => layout(tiles({ kind: "miniapp", id: "nope" })), ["sections", 0, "tiles", 0, "id"], '"nope" is not a registered mini app'],
    ["an unregistered feed", () => layout(grid(), feed({ miniAppId: "nope" })), ["sections", 1, "miniAppId"], '"nope" is not a registered mini app'],
  ])("names %s and its path", (_label, build, issuePath, message) => {
    // Act & Assert
    expect(toHomeLayoutIssues(build(), registry)).toEqual([{ path: issuePath, message }]);
  });

  it.each([
    ["miniapp", "nope"],
    ["miniapp", "nope/eskara/wristband"],
    ["miniapp", "eskara-2026//evil.com/x"],
    ["miniapp", "Eskara-2026"],
    ["external", "/x"],
    ["external", "http://pf.kakao.com/_cjxexdG/chat"],
    ["webview", "https://evil.com/skku/lostandfound"],
    ["webview", "/"],
    ["webview", "/eskara#/entry"],
    ["route", "campus"],
    ["route", ""],
    ["route", "/map/hssc "],
  ])("names a banner whose %s action is %p, at its actionValue", (actionType, actionValue) => {
    // Act & Assert
    expect(toHomeLayoutIssues(banner({ actionType, actionValue }), registry)).toEqual([
      { path: ["sections", 0, "items", 1, "actionValue"], message: `"banner-a" actionValue "${actionValue}" is not valid for "${actionType}"` },
    ]);
  });

  it.each([
    ["miniapp", "nope"],
    ["miniapp", "nope/eskara/wristband"],
    ["external", "/x"],
    ["webview", "https://evil.com/skku/lostandfound"],
    ["route", "campus"],
  ])("names a link tile whose %s action is %p, at its actionValue", (actionType, actionValue) => {
    // Act & Assert
    expect(toHomeLayoutIssues(linkTile({ actionType, actionValue }), registry)).toEqual([
      { path: ["sections", 0, "tiles", 1, "actionValue"], message: `"campus-map" actionValue "${actionValue}" is not valid for "${actionType}"` },
    ]);
  });

  it.each([
    ["no emoji", "ab", true],
    ["nothing", "", true],
    ["one emoji", "🗺️", false],
    ["one emoji of several code points", "👩‍🍳", false],
    ["two emoji", "🗺️🗺️", true],
  ])("an emoji icon of %s is an issue: %s", (_label, emoji, isIssue) => {
    // Arrange
    const built = layout(grid(), grid({ id: "more", tiles: [link({ icon: { kind: "emoji", emoji } })] }));

    // Act & Assert
    expect(toHomeLayoutIssues(built, registry)).toEqual(
      isIssue ? [{ path: ["sections", 1, "tiles", 0, "icon", "emoji"], message: '"campus-map" icon must be exactly one emoji' }] : [],
    );
  });

  it("lists every issue of a layout, mini app ids first, then link actions, then icons", () => {
    // Arrange
    const built = layout(
      carousel({ items: [image({ actionValue: "nope" })] }),
      tiles(link({ icon: { kind: "emoji", emoji: "ab" }, actionValue: "campus" }), { kind: "miniapp", id: "nope" }),
      feed({ miniAppId: "gone" }),
    );

    // Act
    const issues = toHomeLayoutIssues(built, registry);

    // Assert
    expect(issues).toEqual([
      { path: ["sections", 1, "tiles", 1, "id"], message: '"nope" is not a registered mini app' },
      { path: ["sections", 2, "miniAppId"], message: '"gone" is not a registered mini app' },
      { path: ["sections", 0, "items", 0, "actionValue"], message: '"banner-a" actionValue "nope" is not valid for "miniapp"' },
      { path: ["sections", 1, "tiles", 0, "actionValue"], message: '"campus-map" actionValue "campus" is not valid for "route"' },
      { path: ["sections", 1, "tiles", 0, "icon", "emoji"], message: '"campus-map" icon must be exactly one emoji' },
    ]);
  });
});

describe("homeLayoutReferences", () => {
  it("lists the mini app of a miniapp tile, at its id", () => {
    // Act & Assert
    expect(homeLayoutReferences(layout(grid(), grid({ id: "more", tiles: [{ kind: "game", id: "wave-run" }, { kind: "miniapp", id: "inja" }] })), registry)).toEqual([
      { dataset: "miniapps", id: "mukja", path: ["sections", 0, "tiles", 0, "id"] },
      { dataset: "miniapps", id: "inja", path: ["sections", 1, "tiles", 1, "id"] },
    ]);
  });

  it("lists the mini app of a feed section, at its miniAppId", () => {
    // Act & Assert
    expect(homeLayoutReferences(layout(feed()), registry)).toEqual([{ dataset: "miniapps", id: "eskara-2026", path: ["sections", 0, "miniAppId"] }]);
  });

  it.each([
    ["its root", "eskara-2026"],
    ["a path", "eskara-2026/eskara/wristband"],
  ])("lists the mini app a link tile's miniapp action targets at %s, at its actionValue", (_label, actionValue) => {
    // Act & Assert
    expect(homeLayoutReferences(linkTile({ actionType: "miniapp", actionValue }), registry)).toEqual([
      { dataset: "miniapps", id: "eskara-2026", path: ["sections", 0, "tiles", 1, "actionValue"] },
    ]);
  });

  it.each([
    ["its root", "eskara-2026"],
    ["a path", "eskara-2026/eskara/wristband"],
  ])("lists the mini app a banner's miniapp action targets at %s, at its actionValue", (_label, actionValue) => {
    // Act & Assert
    expect(homeLayoutReferences(banner({ actionValue }), registry)).toEqual([
      { dataset: "miniapps", id: "eskara-2026", path: ["sections", 0, "items", 1, "actionValue"] },
    ]);
  });

  it("lists an unregistered mini app too: whether it resolves is the checks' to say", () => {
    // Act & Assert
    expect(homeLayoutReferences(layout(tiles({ kind: "miniapp", id: "nope" })), registry)).toEqual([
      { dataset: "miniapps", id: "nope", path: ["sections", 0, "tiles", 0, "id"] },
    ]);
  });

  it.each([
    ["a game tile", () => layout(tiles({ kind: "game", id: "wave-run" }))],
    ["a route link tile", () => linkTile({})],
    ["an external banner", () => banner({ actionType: "external", actionValue: "https://pf.kakao.com/_cjxexdG/chat" })],
    ["a webview banner", () => banner({ actionType: "webview", actionValue: "/skku/lostandfound" })],
    ["a banner with no action", () => banner({ actionType: undefined, actionValue: undefined })],
    ["a miniapp target the grammar refuses", () => banner({ actionValue: "eskara-2026//evil.com/x" })],
    ["a route action whose value reads as a mini app id", () => banner({ actionType: "route", actionValue: "mukja" })],
  ])("lists nothing for %s", (_label, build) => {
    // Act & Assert
    expect(homeLayoutReferences(build(), registry)).toEqual([]);
  });

  it("lists every reference in section order, and none in revision 1 of the stored layout", () => {
    // Arrange
    const stored = JSON.parse(fs.readFileSync(DATASET_FIXTURE, "utf8")) as Record<string, unknown>;
    delete stored._about;
    const built = layout(
      carousel({ items: [image({ actionValue: "hssc/" }), { type: "default" }] }),
      feed({ miniAppId: "inja" }),
      tiles(link({ actionType: "miniapp", actionValue: "mukja" }), { kind: "miniapp", id: "skkuw" }),
    );

    // Act & Assert
    expect(homeLayoutReferences(built, registry)).toEqual([
      { dataset: "miniapps", id: "hssc", path: ["sections", 0, "items", 0, "actionValue"] },
      { dataset: "miniapps", id: "inja", path: ["sections", 1, "miniAppId"] },
      { dataset: "miniapps", id: "mukja", path: ["sections", 2, "tiles", 0, "actionValue"] },
      { dataset: "miniapps", id: "skkuw", path: ["sections", 2, "tiles", 1, "id"] },
    ]);
    expect(homeLayoutReferences(homeLayoutFile.parse(stored), registry)).toEqual([]);
  });
});

describe("withoutUnresolvedItems", () => {
  // The registry after a deploy that removed mukja, as the reader sees it.
  const withoutMukja: MiniAppRegistry = {
    isRegistered: (id) => id !== "mukja" && registry.isRegistered(id),
    isKnownMiniAppTarget: (value) => {
      const target = registry.parseTarget(value);
      return target !== null && target.id !== "mukja" && registry.isRegistered(target.id);
    },
    isSingleEmoji: (value) => registry.isSingleEmoji(value),
    parseTarget: (value) => registry.parseTarget(value),
  };
  const served = (built: ReturnType<typeof layout>) => withoutUnresolvedItems(built, toHomeLayoutIssues(built, withoutMukja));

  const buildingMap = link({ id: "building_map", actionValue: "/map/hssc" });

  it("leaves a removed mini app's tile out of its grid and keeps the others in order", () => {
    // Arrange
    const built = layout(tiles({ kind: "miniapp", id: "mukja" }, buildingMap, { kind: "game", id: "wave-run" }));

    // Act & Assert
    expect(served(built)).toEqual(layout(tiles(buildingMap, { kind: "game", id: "wave-run" })));
  });

  it("leaves out the feed section of a removed mini app and serves the sections around it in order", () => {
    // Arrange
    const built = layout(carousel(), feed({ miniAppId: "mukja" }), grid({ id: "more", tiles: [{ kind: "game", id: "wave-run" }] }));

    // Act & Assert
    expect(served(built)).toEqual(layout(carousel(), grid({ id: "more", tiles: [{ kind: "game", id: "wave-run" }] })));
  });

  it("leaves out a grid, title included, when every tile names a removed mini app", () => {
    // Arrange
    const emptied = grid({ title: { ko: "먹자" }, tiles: [{ kind: "miniapp", id: "mukja" }, link({ actionType: "miniapp", actionValue: "mukja/menu" })] });
    const built = layout(carousel(), emptied, feed());

    // Act & Assert
    expect(served(built)).toEqual(layout(carousel(), feed()));
  });

  it("leaves out a banner whose miniapp action targets a removed mini app and keeps the carousel's other items", () => {
    // Arrange
    const kept = image({ id: "banner-b", actionValue: "inja" });
    const built = layout(carousel({ items: [image({ actionValue: "mukja/menu" }), { type: "default" }, kept] }));

    // Act & Assert
    expect(served(built)).toEqual(layout(carousel({ items: [{ type: "default" }, kept] })));
  });

  it("leaves out the tile an icon or action issue points into", () => {
    // Arrange
    const built = layout(tiles(link({ id: "a" }), link({ id: "b" }), link({ id: "c" })));
    const issues = [
      { path: ["sections", 0, "tiles", 0, "icon", "emoji"], message: '"a" icon must be exactly one emoji' },
      { path: ["sections", 0, "tiles", 2, "actionValue"], message: '"c" actionValue "x" is not valid for "route"' },
    ];

    // Act & Assert
    expect(withoutUnresolvedItems(built, issues)).toEqual(layout(tiles(link({ id: "b" }))));
  });

  it("refuses an issue whose path names no section, rather than serve the item it meant", () => {
    // Act & Assert
    expect(() => withoutUnresolvedItems(layout(grid()), [{ path: ["version"], message: "x" }])).toThrow("home layout issue path version names no section");
  });

  it("serves the layout as it is with no issue, and changes nothing it was given", () => {
    // Arrange
    const built = layout(carousel(), feed({ miniAppId: "mukja" }), grid());
    const before = structuredClone(built);

    // Act
    const unchanged = withoutUnresolvedItems(built, []);
    served(built);

    // Assert
    expect(unchanged).toEqual(before);
    expect(built).toEqual(before);
  });
});
