/**
 * The place-detail projection — `GET /map/overlays/event/details`, through
 * MapEventDetailsService over FakeMapRepository; the sheet read's query is
 * pinned in map.repository.spec.ts.
 *
 * The importer refuses a malformed detail, so on the happy path every check in
 * the producer passes. These tests are about the other path: a hand edit in
 * Mongo, which has no reader in front of it. The failure worth fearing there is
 * not a wrong sheet but a 500 — `toI18nText` reads `.ko`, so one block with a
 * missing body would take every sheet of the festival down with it. Every drop
 * below is therefore one block, one action, or at worst one detail.
 */

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import fs from "fs";
import path from "path";
import type { Clock } from "../../infra/clock";
import { MEDIA_ORIGIN } from "../../infra/origins";
import { fixtureMiniappsService } from "../../../__tests__/helpers/miniapps/registry-fixture";
import { MapEventService } from "../event/map-event.service";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import type { MapLayerSetRepository } from "../layer-set/map-layer-set.repository";
import { fixtureLayerSetRepository } from "../../../__tests__/helpers/map/layer-sets-fixture";
import type { MapPlaceDoc } from "../map.document";
import type { MapRepository } from "../map.repository";
import { MapEventDetailsService } from "./map-event-details.service";
import { logText } from "../../../__tests__/helpers/log-text";
import { FakeMapRepository } from "../../../__tests__/helpers/fakes/map/map.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";

// scripts/ is plain CommonJS excluded from tsconfig, so this is a require.
const { parsePlacesFile } = require("../../../scripts/lib/map-places-file");
const REAL_FILE = path.join(__dirname, "../../../scripts/data/eskara-2026-places.json");

const CLOCK: Clock = { now: () => new Date("2026-10-01T03:00:00.000Z") };

// The live activation, stated per test; the fake answers with it.
const mockFindActiveActivation = jest.fn<ReturnType<MapRepository["findActiveActivation"]>, [Date]>();
const findActiveActivation = mockFindActiveActivation;

let repository: FakeMapRepository;
// The sheet read, so a test can say no place was read.
let mockPlaces: jest.SpyInstance<ReturnType<MapRepository["listPlacesWithDetailByLayerSetId"]>, [string]>;

// Each service caches the event read path; each test starts with fresh ones.
let detailsService: MapEventDetailsService;
let eventService: MapEventService;
beforeEach(() => {
  findActiveActivation.mockReset();
  repository = new FakeMapRepository();
  repository.findActiveActivation = mockFindActiveActivation;
  mockPlaces = jest.spyOn(repository, "listPlacesWithDetailByLayerSetId");
  const real = asReal<MapRepository>(repository);
  const layerSet = new MapLayerSetService(real, asReal<MapLayerSetRepository>(fixtureLayerSetRepository()), CLOCK);
  detailsService = new MapEventDetailsService(real, layerSet);
  eventService = new MapEventService(real, layerSet, fixtureMiniappsService());
});
const getEventPlaceDetails = () => detailsService.getEventPlaceDetails();
const getEventOverlays = () => eventService.getEventOverlays();

const PHOTO = `${MEDIA_ORIGIN}/eskara-2026/food-trucks/truck-x/01-abcdef12.jpg`;

function arrange(docs: unknown[]) {
  repository.places = docs as MapPlaceDoc[];
  return mockPlaces;
}

function place(detail: unknown, over: Record<string, unknown> = {}) {
  return {
    _id: "eskara-2026-truck-x",
    layerSetId: "eskara-2026",
    campus: "nsc",
    category: "food",
    location: { type: "Point", coordinates: [126.971501, 37.29542] },
    title: { ko: "오야봉" },
    subtitle: null,
    hours: [],
    fields: [],
    actions: [],
    order: 20,
    detail,
    updatedAt: new Date(),
    ...over,
  };
}

function truckDetail(over: Record<string, unknown> = {}) {
  return {
    kind: "foodTruck",
    org: null,
    isUnion: false,
    locationLabel: null,
    actions: [],
    blocks: [
      { type: "table", id: "menu", title: null, rows: [{ label: { ko: "닭꼬치" }, value: { ko: "5,000원" } }] },
      { type: "image", id: "photo-1", title: null, url: PHOTO, caption: { ko: "닭꼬치" } },
    ],
    ...over,
  };
}

/** The one warning line, when a drop is expected. */
function warned(): string {
  expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  return logText(mockLogger.warn.mock.calls[0]);
}

describe("MapEventDetailsService.getEventPlaceDetails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);
  });

  it("reads once for any number of concurrent requests", async () => {
    // Arrange
    const find = arrange([]);

    // Act
    await Promise.all([getEventPlaceDetails(), getEventPlaceDetails(), getEventPlaceDetails()]);

    // Assert
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("returns nothing, and reads nothing, when no festival is live", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(null);

    // Act & Assert
    await expect(getEventPlaceDetails()).resolves.toEqual({ details: {} });
    expect(mockPlaces).not.toHaveBeenCalled();
  });

  it("asks the repository for the live set's places that carry a sheet", async () => {
    // Arrange
    const find = arrange([]);

    // Act
    await getEventPlaceDetails();

    // Assert
    // The `detail: { $ne: null }` filter is pinned in map.repository.spec.ts.
    expect(find).toHaveBeenCalledWith("eskara-2026");
  });

  it("projects a detail onto the app's PlaceSheet, keyed by the tap id", async () => {
    // Arrange
    arrange([
      place(
        truckDetail({
          org: { ko: "뉴플레이스컴퍼니", zh: "新地方公司" },
          isUnion: true,
          locationLabel: { ko: "푸드트럭존 1번", en: "Food truck 1" },
          actions: [
            {
              type: "instagram",
              id: "insta",
              label: { ko: "인스타" },
              profileUrl: "https://www.instagram.com/example_handle_01",
              postUrl: null,
            },
            { type: "link", id: "guide", label: { ko: "안내" }, url: "https://skkuverse.com/eskara" },
          ],
          blocks: [
            { type: "table", id: "menu", title: null, rows: [{ label: { ko: "닭꼬치" }, value: { ko: "5,000원" } }] },
            { type: "image", id: "photo-1", title: null, url: PHOTO, caption: { ko: "닭꼬치" } },
            { type: "text", id: "intro", title: { ko: "소개" }, body: { ko: "숯불", en: "Charcoal" } },
            { type: "list", id: "l", title: null, items: [{ emoji: null, title: { ko: "퀴즈" }, description: null }] },
            { type: "notice", id: "n", title: null, items: [{ ko: "현금 가능" }] },
          ],
        }),
      ),
    ]);

    // Act
    const { details } = await getEventPlaceDetails();

    // Assert
    expect(details).toEqual({
      "eskara-2026-truck-x": {
        placeId: "eskara-2026-truck-x",
        kind: "foodTruck",
        // `en` falls back to `ko`; `zh` ships only when authored — the overlay's rule.
        org: { ko: "뉴플레이스컴퍼니", en: "뉴플레이스컴퍼니", zh: "新地方公司" },
        isUnion: true,
        locationLabel: { ko: "푸드트럭존 1번", en: "Food truck 1" },
        actions: [
          {
            type: "instagram",
            id: "insta",
            label: { ko: "인스타", en: "인스타" },
            profileUrl: "https://www.instagram.com/example_handle_01",
            postUrl: null,
          },
          { type: "link", id: "guide", label: { ko: "안내", en: "안내" }, url: "https://skkuverse.com/eskara" },
        ],
        blocks: [
          {
            type: "table",
            id: "menu",
            title: null,
            rows: [{ label: { ko: "닭꼬치", en: "닭꼬치" }, value: { ko: "5,000원", en: "5,000원" } }],
          },
          { type: "image", id: "photo-1", title: null, url: PHOTO, caption: { ko: "닭꼬치", en: "닭꼬치" } },
          { type: "text", id: "intro", title: { ko: "소개", en: "소개" }, body: { ko: "숯불", en: "Charcoal" } },
          {
            type: "list",
            id: "l",
            title: null,
            items: [{ emoji: null, title: { ko: "퀴즈", en: "퀴즈" }, description: null }],
          },
          { type: "notice", id: "n", title: null, items: [{ ko: "현금 가능", en: "현금 가능" }] },
        ],
      },
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("drops an image off the media host, and keeps the rest of the sheet", async () => {
    // Arrange
    arrange([
      place(
        truckDetail({
          blocks: [
            { type: "table", id: "menu", title: null, rows: [{ label: { ko: "a" }, value: { ko: "b" } }] },
            { type: "image", id: "photo-1", title: null, url: "https://i.imgur.com/x.jpg", caption: null },
          ],
        }),
      ),
    ]);

    // Act
    const { details } = await getEventPlaceDetails();

    // Assert
    expect(details["eskara-2026-truck-x"]!.blocks.map((b) => b.id)).toEqual(["menu"]);
    expect(warned()).toMatch(/photo-1: image url "https:\/\/i\.imgur\.com\/x\.jpg" is not on the media host/);
  });

  it.each([
    ["an unknown block type", { type: "video", id: "v" }, /unknown block type "video"/],
    ["a text block with no body", { type: "text", id: "t", title: null }, /text block is missing a required field/],
    ["a table row with a blank value", { type: "table", id: "m", title: null, rows: [{ label: { ko: "a" }, value: { ko: " " } }] }, /table block/],
    ["an empty list", { type: "list", id: "l", title: null, items: [] }, /list block/],
    ["a notice holding a non-text item", { type: "notice", id: "n", title: null, items: [42] }, /notice block/],
    ["a block with no id", { type: "text", body: { ko: "x" } }, /not a block with an id/],
  ])("drops %s instead of failing the route", async (_name, block, reason) => {
    // Arrange
    arrange([place(truckDetail({ blocks: [block] }))]);

    // Act
    const { details } = await getEventPlaceDetails();

    // Assert
    expect(details["eskara-2026-truck-x"]!.blocks).toEqual([]);
    expect(warned()).toMatch(reason);
  });

  it.each([
    ["a blank label", { type: "link", id: "a", label: { ko: "" }, url: "https://skkuverse.com/" }, /label is blank/],
    ["a relative link", { type: "link", id: "a", label: { ko: "x" }, url: "/eskara" }, /not an absolute https URL/],
    ["a profile that is a post", { type: "instagram", id: "a", label: { ko: "x" }, profileUrl: "https://www.instagram.com/p/X" }, /not an Instagram profile/],
    ["an unknown action type", { type: "call", id: "a", label: { ko: "x" } }, /unknown action type "call"/],
  ])("drops an action with %s", async (_name, action, reason) => {
    // Arrange
    arrange([place(truckDetail({ actions: [action] }))]);

    // Act
    const { details } = await getEventPlaceDetails();

    // Assert
    expect(details["eskara-2026-truck-x"]!.actions).toEqual([]);
    expect(warned()).toMatch(reason);
  });

  it("keeps an Instagram button whose post link is bad, pointing it at the profile", async () => {
    // Arrange
    arrange([
      place(
        truckDetail({
          actions: [
            {
              type: "instagram",
              id: "insta",
              label: { ko: "인스타" },
              profileUrl: "https://www.instagram.com/example_handle_01",
              postUrl: "https://www.instagram.com/example_handle_01",
            },
          ],
        }),
      ),
    ]);

    // Act
    const { details } = await getEventPlaceDetails();

    // Assert
    expect(details["eskara-2026-truck-x"]!.actions).toEqual([
      expect.objectContaining({ id: "insta", postUrl: null }),
    ]);
    expect(warned()).toMatch(/postUrl .* is not an Instagram post/);
  });

  it.each([
    ["an unknown kind", truckDetail({ kind: "truck" })],
    ["a detail that is not an object", "foodTruck"],
    ["blocks that are not a list", truckDetail({ blocks: null })],
  ])("drops the whole detail for %s, and serves the other places", async (_name, bad) => {
    // Arrange
    arrange([place(bad), place(truckDetail(), { _id: "eskara-2026-truck-y" })]);

    // Act
    const { details } = await getEventPlaceDetails();

    // Assert
    expect(Object.keys(details)).toEqual(["eskara-2026-truck-y"]);
    expect(warned()).toMatch(/eskara-2026-truck-x: detail is unreadable/);
  });

  it("gives no detail to a place the overlay route would not serve", async () => {
    // Arrange
    arrange([place(truckDetail(), { title: { ko: "" } })]);

    // Act
    const { details } = await getEventPlaceDetails();

    // Assert
    // The place is left out, and logged, where it is parsed: map.repository.spec.ts.
    expect(details).toEqual({});
  });

  it("gives no detail to a place on an inert category, which nothing can tap", async () => {
    // Arrange
    // `control_entry_label` is stored `interactive: false` in revision 1 of map-layer-sets.
    arrange([place(truckDetail(), { category: "control_entry_label" })]);

    // Act
    const { details } = await getEventPlaceDetails();

    // Assert
    expect(details).toEqual({});
    expect(warned()).toMatch(/is not tappable/);
  });

  it("gives no detail to a place whose tap runs a chip, which opens no sheet", async () => {
    // Arrange
    // `food_zone` carries `tapChip: eskara26_view_food` in revision 1 of map-layer-sets.
    arrange([place(truckDetail(), { category: "food_zone" })]);

    // Act
    const { details } = await getEventPlaceDetails();

    // Assert
    expect(details).toEqual({});
    expect(warned()).toMatch(/taps to chip "eskara26_view_food"/);
  });
});

describe("the committed sheet, importer to wire", () => {
  // The importer and this producer each hold a copy of every rule. This runs the
  // REAL sheet through both, so a rule the importer lets through and the
  // producer would drop fails here rather than as a missing photo on a phone.
  it("serves every authored detail whole, each on a pin the overlay route taps", async () => {
    // Arrange
    jest.clearAllMocks();
    const { docs, errors } = parsePlacesFile(fs.readFileSync(REAL_FILE, "utf8"), {
      layerSetId: "eskara-2026",
    });
    expect(errors).toEqual([]);
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);
    // The fake applies the one filter the producer relies on Mongo for.
    repository.places = docs;

    // Act
    const { details } = await getEventPlaceDetails();
    const { overlays } = await getEventOverlays();

    // Assert
    const authored = docs.filter((d: { detail: unknown }) => d.detail !== null);
    expect(authored.length).toBeGreaterThan(0);
    expect(Object.keys(details).sort()).toEqual(authored.map((d: { _id: string }) => d._id).sort());
    for (const d of authored) {
      expect(details[d._id]!.blocks).toHaveLength(d.detail.blocks.length);
      expect(details[d._id]!.actions).toHaveLength(d.detail.actions.length);
    }
    expect(mockLogger.warn).not.toHaveBeenCalled();

    const tapped = new Set(
      overlays.map((o) => (o.tap && o.tap.kind !== "chip" ? o.tap.placeId : undefined)),
    );
    for (const id of Object.keys(details)) expect([id, tapped.has(id)]).toEqual([id, true]);

    // The trucks' pins name an area, not a spot — the app opens their sheets tall
    // for it. Every other pin on the map is exact.
    const accuracy = (overlays as Array<{ id: string; kind: string; locationAccuracy?: string }>)
      .filter((o) => o.kind === "marker")
      .map((o) => [o.id, o.locationAccuracy]);
    const trucks = accuracy.filter(([id]) => id!.includes("-truck-"));
    expect(trucks).toHaveLength(17);
    expect(new Set(trucks.map(([, a]) => a))).toEqual(new Set(["area"]));
    expect(new Set(accuracy.filter(([id]) => !id!.includes("-truck-")).map(([, a]) => a))).toEqual(
      new Set(["exact"]),
    );
  });
});
