/**
 * The home layout as loaded: the boot-time check (loadHomeLayout: the structure
 * in ui-home.schema.ts plus the registry issues of ui-home.rules.ts, whose
 * cases live in their own specs) and the committed home-layout.json, resolved
 * per request.
 *
 * The check runs against OUR OWN config, so each rejection here is a deploy
 * that must not start. Mini-app ids are checked against the real registry.
 */
import type { Clock } from "../../infra/clock";
import { MapConfigService } from "../../map/config/map-config.service";
import { MapLayerSetService } from "../../map/layer-set/map-layer-set.service";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { loadHomeLayout as loadWithRegistry, readHomeLayout } from "./ui-home.config";
import { toHomeLayout } from "./ui-home.mapper";
import type { HomeLayoutRaw } from "./ui-home.schema";
import { FakeMapRepository } from "../../../__tests__/helpers/fakes/map/map.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";

const registry = new MiniappsService();
const committedLayout = readHomeLayout(registry);
// No festival is live in the empty fake, so /map/config serves only its permanent chips.
const clock: Clock = { now: () => new Date("2026-10-13T03:00:00.000Z") };
const map = new MapConfigService(new MapLayerSetService(asReal<ConstructorParameters<typeof MapLayerSetService>[0]>(new FakeMapRepository()), clock, registry));

const resolveLogo = registry.resolveLogo.bind(registry);

const loadHomeLayout = (raw: unknown): Readonly<HomeLayoutRaw> => loadWithRegistry(raw, registry);

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

function layout(...sections: Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, sections };
}

describe("committed home-layout.json", () => {
  it("loads, so the module import in this file did not throw", () => {
    // Act
    const resolved = toHomeLayout(committedLayout, { lang: "ko", now: new Date(), resolveLogo });

    // Assert
    expect(resolved.version).toBe(1);
    expect(resolved.sections.map((s) => s.type)).toContain("banner_carousel");
  });

  it.each(["ko", "en", "zh"] as const)(
    "home_tiles (%s): the map's four permanent chips, then the games, in one grid",
    async (lang) => {
      // Act
      const resolved = toHomeLayout(committedLayout, { lang, now: new Date(), resolveLogo });
      const { chips } = await map.getMapConfig(lang);

      // Assert
      // One grid: the app puts a 24 pt gap after each grid, so a second grid
      // for the games would read as a new section (2026-10-09).
      expect(resolved.sections.map((s) => s.id)).toEqual(["home_top", "home_tiles"]);
      const homeRow = resolved.sections.find((s) => s.id === "home_tiles") as unknown as {
        tiles: Array<{ kind: string; id: string; title?: string; actionType?: string; actionValue?: string }>;
      };
      // The four service tiles mean the same thing as the map's permanent chips,
      // which took over the campus sheet's buttons; builds that drop a link chip
      // still reach them here.
      const links = chips.flatMap(({ id, label, action }) =>
        action.kind === "link" ? [{ kind: "link", id, title: label, actionType: action.actionType, actionValue: action.actionValue }] : [],
      );
      expect(links).toHaveLength(4);
      expect(
        homeRow.tiles.slice(0, 4).map(({ kind, id, title, actionType, actionValue }) => ({ kind, id, title, actionType, actionValue })),
      ).toEqual(links);
      expect(homeRow.tiles.slice(4)).toEqual([
        { kind: "game", id: "subway-typing" },
        { kind: "game", id: "wave-run" },
      ]);
    },
  );
});

describe("loadHomeLayout", () => {
  // The cases of each check live with the check: structure and duplicate ids in ui-home.schema.spec.ts,
  // registry issues in ui-home.rules.spec.ts. These pin that the boot still refuses both kinds.
  it("accepts a well-formed layout", () => {
    // Act & Assert
    expect(() => loadHomeLayout(layout(carousel(), grid()))).not.toThrow();
  });

  it("refuses a registry issue, naming its path", () => {
    // Act & Assert
    expect(() => loadHomeLayout(layout(grid(), grid({ id: "more", tiles: [link({ icon: { kind: "emoji", emoji: "🗺️🗺️" } })] })))).toThrow(
      /^home layout: sections\.1\.tiles\.0\.icon\.emoji: "campus-map" icon must be exactly one emoji$/,
    );
  });

  it("refuses a structural issue, naming its path", () => {
    // Act & Assert
    expect(() => loadHomeLayout(layout(grid(), grid({ id: "more", tiles: [link(), link()] })))).toThrow(
      'home layout: sections.1.tiles.1.id: tile "campus-map" is placed more than once',
    );
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

  it("resolves to the wire shape with the title in the request language and a default limit", () => {
    // Arrange
    const source = loadHomeLayout(
      layout(feed(), feed({ id: "bare", title: undefined, limit: undefined })),
    );

    // Act
    const { sections } = toHomeLayout(source, { lang: "en", now: new Date(), resolveLogo });

    // Assert
    expect(sections).toEqual([
      { type: "miniapp_feed", id: "eskara_feed", miniAppId: "eskara-2026", title: "ESKARA live", limit: 3 },
      { type: "miniapp_feed", id: "bare", miniAppId: "eskara-2026", limit: 3 },
    ]);
  });
});
