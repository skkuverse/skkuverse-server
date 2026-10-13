/**
 * MapEventService: the place → overlay projection behind GET /map/overlays/event,
 * run over the real repository, layer-set service and shipped layer-set config,
 * with the Mongo collections stubbed.
 *
 * One document in, one marker out. There is no join any more: a booth that runs
 * on both festival days is ONE document carrying two opening windows, which is
 * the whole point of the collapse — the old model made it two `sessions`, and
 * the list rendered the same place twice with nothing to tell the rows apart.
 *
 * The assertions worth having are the ones that fail silently in production: a
 * [lng,lat] swap puts the booth in the ocean, a campus the app does not
 * recognise makes the marker vanish inside the client parser with no error, an
 * unmapped category would drop a real booth off the festival map, and a lost
 * `zh` leaves a map whose layer labels are Chinese and whose booths are not.
 */

// The places collection, handed out by name; activations are read through a spy below.
const mockPlaces = jest.fn();
jest.mock("../../infra/mongo", () => ({
  ensureIndexesAtBoot: jest.fn(),
  mongoCollection: (_db: string, name: string) => (name === "places" ? mockPlaces() : {}),
}));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { Clock } from "../../infra/clock";
import { MiniAppsService } from "../../miniapps/miniapps.service";
import { getLayerSetConfig } from "../layer-set/map-layer-set.config";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import { EVENT_CACHE_TTL_MS } from "../map.constants";
import { MapRepository } from "../map.repository";
import { presentationFor } from "../map.rules";
import { MapEventService } from "./map-event.service";
import { logText } from "../../../__tests__/helpers/log-text";

const mockFindActiveActivation = jest.spyOn(MapRepository.prototype, "findActiveActivation");

/** A cold service: the activation and overlay caches live on the instances. */
function newService(): MapEventService {
  const repository = new MapRepository();
  return new MapEventService(repository, new MapLayerSetService(repository, new Clock()), new MiniAppsService());
}

let service: MapEventService;
const getEventOverlays = () => service.getEventOverlays();
const clearEventOverlaysCache = (): void => {
  service = newService();
};

// The event read path is cached per process; each test starts cold.
beforeEach(() => {
  clearEventOverlaysCache();
});

const loaded = getLayerSetConfig("eskara-2026");
if (!loaded?.config) throw new Error(`eskara-2026 failed to load: ${loaded?.error}`);
const CONFIG = loaded.config;

/** A collection stub whose `find()` records its filter and yields `docs`. */
function collectionOf(docs: unknown[]) {
  const find = jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue(docs),
  });
  return { stub: { find } as never, find };
}

const DAY_1 = {
  startAt: new Date("2026-10-01T09:00:00.000Z"),
  endAt: new Date("2026-10-01T15:00:00.000Z"),
};
const DAY_2 = {
  startAt: new Date("2026-10-02T09:00:00.000Z"),
  endAt: new Date("2026-10-02T15:00:00.000Z"),
};

function place(over: Record<string, unknown> = {}) {
  return {
    _id: "eskara-2026-booth-01",
    layerSetId: "eskara-2026",
    campus: "nsc",
    category: "booth",
    // GeoJSON order: [lng, lat].
    location: { type: "Point", coordinates: [126.971747, 37.294452] },
    title: { ko: "우끼끼친", en: "Ukkikki" },
    subtitle: { ko: "생명공학대학 학생회" },
    hours: [DAY_1, DAY_2],
    fields: [],
    actions: [],
    order: 10,
    updatedAt: new Date(),
    ...over,
  };
}

function arrange(docs: unknown[]) {
  const p = collectionOf(docs);
  mockPlaces.mockReturnValue(p.stub);
  return { placesFind: p.find };
}

describe("MapEventService.getEventOverlays", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<MapRepository["findActiveActivation"]>>);
  });

  it("scans once for any number of concurrent requests", async () => {
    // Arrange
    const { placesFind } = arrange([place()]);

    // Act
    await Promise.all([getEventOverlays(), getEventOverlays(), getEventOverlays()]);
    await getEventOverlays();

    // Assert
    expect(placesFind).toHaveBeenCalledTimes(1);
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(1);
  });

  it("serves the last projection when a re-scan fails", async () => {
    // Arrange
    let clock = Date.now();
    const spy = jest.spyOn(Date, "now").mockImplementation(() => clock);

    // Act & Assert
    try {
      const { placesFind } = arrange([place()]);
      const first = await getEventOverlays();

      placesFind.mockImplementation(() => ({
        toArray: jest.fn().mockRejectedValue(new Error("mongo down")),
      }));
      clock += 2 * EVENT_CACHE_TTL_MS;
      await expect(getEventOverlays()).resolves.toBe(first);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns nothing when no activation is live", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue(null);

    // Act & Assert
    // No festival today is an ordinary answer, not an error — and it must not
    // touch Mongo at all.
    await expect(getEventOverlays()).resolves.toEqual({ overlays: [] });
    expect(mockPlaces).not.toHaveBeenCalled();
  });

  it("returns nothing when the live layer set has no config this build knows", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2099",
    } as Awaited<ReturnType<MapRepository["findActiveActivation"]>>);

    // Act & Assert
    // Not an error: the config is what says which layer a category belongs to,
    // and without it there is nothing correct to serve. Mongo is not consulted.
    await expect(getEventOverlays()).resolves.toEqual({ overlays: [] });
    expect(mockPlaces).not.toHaveBeenCalled();
  });

  it("projects one document to one overlay", async () => {
    // Arrange
    arrange([place()]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers).toHaveLength(1);
    expect(markers[0]).toEqual({
      // A Point becomes a marker. The renderer is named by `kind` rather than
      // inferred from a layer, which is what lets one layer draw pins and a
      // zone at once.
      kind: "marker",
      id: "eskara-2026-booth-01",
      layerId: "eskara26_booth",
      campus: "nsc",
      // The STORED object, verbatim. [lng, lat] — the ~126 one is longitude;
      // if these ever trade places the booth lands off the coast of Africa.
      geometry: { type: "Point", coordinates: [126.971747, 37.294452] },
      text: { ko: "우끼끼친", en: "Ukkikki" },
      subtitle: { ko: "생명공학대학 학생회", en: "생명공학대학 학생회" },
      hours: [
        { startAt: "2026-10-01T09:00:00.000Z", endAt: "2026-10-01T15:00:00.000Z", label: null },
        { startAt: "2026-10-02T09:00:00.000Z", endAt: "2026-10-02T15:00:00.000Z", label: null },
      ],
      fields: [],
      actions: [],
      order: 10,
      // Every facet of the config is keyed, `[]` where the place is in none.
      facets: { day: ["day1", "day2"], org: [] },
      orderByOption: {},
      pinPriority: presentationFor(CONFIG, "booth").pinPriority,
      locationAccuracy: "exact",
      tap: { kind: "event", placeId: "eskara-2026-booth-01" },
    });
  });

  it("scans the live layer set and nothing else — one cursor, no join", async () => {
    // Arrange
    const { placesFind } = arrange([place()]);

    // Act
    await getEventOverlays();

    // Assert
    // No lifecycle filter: a cancelled booth is DELETED, not flagged, so there
    // is no state left for a filter to exclude.
    expect(placesFind).toHaveBeenCalledTimes(1);
    expect(placesFind).toHaveBeenCalledWith(
      { layerSetId: "eskara-2026" },
      { maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
  });

  it("keeps every opening window, in the order it was authored", async () => {
    // Arrange
    // The reason the whole collapse happened: two days is two windows on ONE
    // document, not two documents. A projection that flattened this back to a
    // single window would re-introduce the duplicate rows it exists to remove.
    arrange([place()]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers[0]!.hours).toEqual([
      { startAt: "2026-10-01T09:00:00.000Z", endAt: "2026-10-01T15:00:00.000Z", label: null },
      { startAt: "2026-10-02T09:00:00.000Z", endAt: "2026-10-02T15:00:00.000Z", label: null },
    ]);
  });

  it("serves an open-ended, labelled window rather than dropping the place", async () => {
    // Arrange
    // A 팔찌 배부 booth: 단체 입장 until 14:00, then 개별 입장 with no announced
    // end. The serve guard used to demand a Date on both sides, so a `null` end
    // would have skipped the whole booth with only a log line.
    arrange([
      place({
        hours: [
          {
            startAt: new Date("2026-10-02T03:00:00.000Z"),
            endAt: new Date("2026-10-02T05:00:00.000Z"),
            label: { ko: "단체 입장", en: "Group entry" },
          },
          { startAt: new Date("2026-10-02T05:00:00.000Z"), endAt: null, label: { ko: "개별 입장" } },
        ],
      }),
    ]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers[0]!.hours).toEqual([
      {
        startAt: "2026-10-02T03:00:00.000Z",
        endAt: "2026-10-02T05:00:00.000Z",
        label: { ko: "단체 입장", en: "Group entry" },
      },
      // `en` falls back to the Korean, as every other wire string does.
      { startAt: "2026-10-02T05:00:00.000Z", endAt: null, label: { ko: "개별 입장", en: "개별 입장" } },
    ]);
  });

  it("carries an always-open place through as an empty window list", async () => {
    // Arrange
    arrange([place({ _id: "toilet", category: "facility", hours: [] })]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    // `[]` has exactly ONE meaning — always open — which the old
    // `startAt: null, endAt: null` could not manage: it meant both an always-on
    // 화장실 and a rain-cancelled bar, and `status` existed to tell them apart.
    expect(markers[0]!.hours).toEqual([]);
    expect(markers[0]!.layerId).toBe("eskara26_facility");
  });

  it("files every place on the layer its category resolves to", async () => {
    // Arrange
    // `presentationFor` is the ONE table from a category to a layer. Going
    // through it rather than reimplementing the mapping is what keeps a 주점 pin
    // on the same layer the 주점 chip shows.
    const docs = [
      place({ _id: "bar-1", category: "bar" }),
      place({ _id: "booth-1", category: "booth" }),
      place({ _id: "unmapped-1", category: "전시" }),
    ];
    arrange(docs);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers.map((m) => m.id).sort()).toEqual(["bar-1", "booth-1", "unmapped-1"]);
    for (const marker of markers) {
      const category = docs.find((d) => d._id === marker.id)!.category;
      const presentation = presentationFor(CONFIG, category);
      expect(marker.layerId).toBe(presentation.layerId);
      expect(marker.kind).toBe("marker");
      if (marker.kind === "marker") {
        expect(marker.pinPriority).toBe(presentation.pinPriority);
      }
      expect(CONFIG.layers.some((l) => l.id === marker.layerId)).toBe(true);
    }
  });

  it("files an unmapped category under the fallback layer rather than dropping it", async () => {
    // Arrange
    // `category` is an open string so next year's 전시 is a Mongo edit. A booth
    // nobody can see is not a reportable bug, so it lands somewhere visible.
    arrange([place({ category: "전시" })]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers).toHaveLength(1);
    expect(markers[0]!.layerId).toBe(CONFIG.itemDefaults.fallback.layerId);
  });

  it("taps through to the place itself, not to a plot", async () => {
    // Arrange
    // Two booths sharing one plot used to resolve to one `placeId` and one
    // stack. They are two documents now, so a tap names exactly one of them.
    arrange([place({ _id: "nightbar-nareun" }), place({ _id: "nightbar-f1" })]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers.map((m) => m.tap)).toEqual([
      { kind: "event", placeId: "nightbar-nareun" },
      { kind: "event", placeId: "nightbar-f1" },
    ]);
  });

  it("takes campus from the document that holds the coordinates", async () => {
    // Arrange
    arrange([place({ campus: "hssc" })]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    // One document now, so campus and position cannot disagree — which is what
    // the old "take the plot's campus, not the session's copy" rule was for.
    expect(markers[0]!.campus).toBe("hssc");
  });

  it("falls back to Korean when a title has no English", async () => {
    // Arrange
    arrange([place({ title: { ko: "에라의 불시착" } })]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers[0]!.text).toEqual({ ko: "에라의 불시착", en: "에라의 불시착" });
    expect("zh" in markers[0]!.text).toBe(false);
  });

  it("carries an ops-authored Chinese title through to the wire", async () => {
    // Arrange
    arrange([place({ title: { ko: "우끼끼친", en: "Ukkikki", zh: "乌key" } })]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    // Resolving server-side would lose Chinese booth names on a map whose layer
    // labels ARE translated to Chinese.
    expect(markers[0]!.text).toEqual({ ko: "우끼끼친", en: "Ukkikki", zh: "乌key" });
  });

  it("serves a null subtitle when ops authored none", async () => {
    // Arrange
    arrange([place({ subtitle: null })]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers[0]!.subtitle).toBeNull();
  });

  it("keeps card fields in their authored order, with their labels", async () => {
    // Arrange
    // Ordering and the human label "메뉴" are the only two things the deleted
    // cardTemplates bought. As data they cost nothing and survive a release.
    arrange([
      place({
        fields: [
          { label: { ko: "메뉴", en: "Menu" }, value: { ko: "골뱅이소면 · 감자튀김" } },
          { label: { ko: "안내" }, value: { ko: "현금만 받아요", zh: "只收现金" } },
        ],
      }),
    ]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers[0]!.fields).toEqual([
      { label: { ko: "메뉴", en: "Menu" }, value: { ko: "골뱅이소면 · 감자튀김", en: "골뱅이소면 · 감자튀김" } },
      { label: { ko: "안내", en: "안내" }, value: { ko: "현금만 받아요", en: "현금만 받아요", zh: "只收现金" } },
    ]);
  });

  it("carries sheet actions through, resolving a webview path to a complete URL", async () => {
    // Arrange
    arrange([
      place({
        actions: [
          {
            id: "timetable",
            label: { ko: "타임테이블 보기", en: "Timetable" },
            actionType: "webview",
            // Root-relative is the PREFERRED authoring spelling. It must never
            // reach the client that way: a relative string handed to a URL
            // opener is the shape of an open redirect.
            actionValue: "/eskara/timetable",
            style: "primary",
          },
        ],
      }),
    ]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect(markers[0]!.actions).toHaveLength(1);
    const action = markers[0]!.actions[0]!;
    expect(action.label).toEqual({ ko: "타임테이블 보기", en: "Timetable" });
    expect(action.style).toBe("primary");
    expect(action.actionValue).toMatch(/^https:\/\/[^/]+\/eskara\/timetable$/);
  });

  describe("action validation — one bad button, not one lost booth", () => {
    async function actionsFor(action: Record<string, unknown>) {
      arrange([place({ actions: [action] })]);
      // Some cases call this twice with different documents; start each cold.
      clearEventOverlaysCache();
      const { overlays: markers } = await getEventOverlays();
      return markers[0]!.actions;
    }

    const label = { ko: "안내" };

    it("drops a webview pointing off the webview origin", async () => {
      // Act & Assert
      expect(
        await actionsFor({
          id: "evil",
          label,
          actionType: "webview",
          actionValue: "https://evil.example.com/steal",
        }),
      ).toEqual([]);
    });

    it("drops a value carrying whitespace, which a spreadsheet paste supplies", async () => {
      // Act & Assert
      // `$` without the `m` flag matches before a trailing newline, so anchors
      // alone would let "https://evil.com\n" through.
      expect(
        await actionsFor({
          id: "sponsor",
          label,
          actionType: "external",
          actionValue: "https://www.skku.edu/\n",
        }),
      ).toEqual([]);
    });

    it("requires a route to be root-relative", async () => {
      // Act & Assert
      expect(
        await actionsFor({
          id: "r",
          label,
          actionType: "route",
          actionValue: "//evil.example.com",
        }),
      ).toEqual([]);
      expect(
        await actionsFor({
          id: "r",
          label,
          actionType: "route",
          actionValue: "/(tabs)/transit",
        }),
      ).toHaveLength(1);
    });

    it("keeps a mini-app target naming a registered mini app, verbatim", async () => {
      // Act
      const kept = await actionsFor({
        id: "wristband",
        label,
        actionType: "miniapp",
        actionValue: "eskara-2026/eskara/wristband",
      });

      // Assert
      expect(kept).toHaveLength(1);
      // Not resolved to a URL: the device resolves the path against the startUrl
      // it fetched, so the wire carries the target exactly as authored.
      expect(kept[0]!.actionValue).toBe("eskara-2026/eskara/wristband");
    });

    it.each([
      ["an unregistered mini app", "no-such-app/x"],
      ["a URL instead of a target", "https://eskara.miniapp.skkuverse.com/eskara"],
      ["a path that names another host", "eskara-2026//evil.example.com"],
    ])("drops a miniapp action naming %s", async (_l, actionValue) => {
      // Act & Assert
      expect(
        await actionsFor({ id: "m", label, actionType: "miniapp", actionValue }),
      ).toEqual([]);
    });

    it("keeps content prose, which may hold spaces and newlines", async () => {
      // Act
      const kept = await actionsFor({
        id: "reward",
        label,
        actionType: "content",
        actionValue: "도장 4개 — 추첨 볼 1개\n도장 5개 — 키링",
      });

      // Assert
      expect(kept).toHaveLength(1);
      expect(kept[0]!.actionValue).toContain("\n");
    });

    it("drops a button whose label is blank in every language", async () => {
      // Act & Assert
      expect(
        await actionsFor({
          id: "blank",
          label: { ko: "" },
          actionType: "content",
          actionValue: "본문",
        }),
      ).toEqual([]);
    });

    it("drops an unknown action type rather than shipping it", async () => {
      // Act & Assert
      expect(
        await actionsFor({
          id: "future",
          label,
          actionType: "teleport",
          actionValue: "https://example.com",
        }),
      ).toEqual([]);
    });

    it("keeps the good buttons when one is bad", async () => {
      // Arrange
      arrange([
        place({
          actions: [
            { id: "ok", label, actionType: "content", actionValue: "본문" },
            { id: "bad", label, actionType: "webview", actionValue: "https://evil.example.com" },
          ],
        }),
      ]);

      // Act
      const { overlays: markers } = await getEventOverlays();

      // Assert
      // Losing one button is recoverable; losing the booth is not.
      expect(markers[0]!.actions.map((a) => a.id)).toEqual(["ok"]);
    });
  });

  describe("an unusable document must not take the festival down", () => {
    // The posture the old join had for a dangling placeId, restored: skip it,
    // count it, log once. A projection with no per-document tolerance turns one
    // bad row into a 500 for all 61 markers, for the whole festival.

    it("skips a legacy document from the pre-collapse schema", async () => {
      // Arrange
      // The real hazard. Prod holds 62 of these — `_id: "nsc-daybooth-01"`,
      // `name` instead of `title`, no `hours` — and the new ids are layer-set
      // prefixed, so the importer never overwrites them. They come back from
      // `find({layerSetId})` and would throw on `doc.title.ko`.
      const legacy = {
        _id: "nsc-daybooth-01",
        layerSetId: "eskara-2026",
        campus: "nsc",
        name: { ko: "주간부스 1번" },
        location: { type: "Point", coordinates: [126.971096, 37.295473] },
        lifecycle: "active",
      };
      arrange([legacy, place()]);

      // Act
      const { overlays: markers } = await getEventOverlays();

      // Assert
      expect(markers.map((m) => m.id)).toEqual(["eskara-2026-booth-01"]);
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(logText(mockLogger.warn.mock.calls[0])).toMatch(/1/);
    });

    it("skips a document whose window has no start", async () => {
      // Arrange
      arrange([place({ _id: "no-start", hours: [{ startAt: null, endAt: null }] }), place()]);

      // Act
      const { overlays: markers } = await getEventOverlays();

      // Assert
      expect(markers.map((m) => m.id)).toEqual(["eskara-2026-booth-01"]);
    });

    it("skips a document whose hours or fields are not arrays", async () => {
      // Arrange
      arrange([place({ _id: "no-hours", hours: undefined }), place()]);

      // Act
      const { overlays: markers } = await getEventOverlays();

      // Assert
      expect(markers.map((m) => m.id)).toEqual(["eskara-2026-booth-01"]);
    });

    it("skips a blank title rather than drawing an invisible pin", async () => {
      // Arrange
      // An empty label still occupies a tap target and a client collision slot.
      // The buildings producer refuses the same case and cites this one.
      arrange([place({ _id: "blank", title: { ko: "" } }), place()]);

      // Act
      const { overlays: markers } = await getEventOverlays();

      // Assert
      expect(markers.map((m) => m.id)).toEqual(["eskara-2026-booth-01"]);
    });

    it("keeps a title that exists only in a language the reader does not use", async () => {
      // Arrange
      // `ko` is declared required on the wire, so it has to be filled from
      // whatever the author DID write rather than shipped as undefined.
      arrange([place({ title: { ko: "", zh: "乌key" } })]);

      // Act
      const { overlays: markers } = await getEventOverlays();

      // Assert
      expect(markers[0]!.text.ko).toBe("乌key");
      expect(markers[0]!.text.en).toBe("乌key");
    });

    it("logs a dropped button instead of losing it silently", async () => {
      // Arrange
      arrange([
        place({
          actions: [
            {
              id: "bad",
              label: { ko: "안내" },
              actionType: "webview",
              actionValue: "https://evil.example.com",
            },
          ],
        }),
      ]);

      // Act
      const { overlays: markers } = await getEventOverlays();

      // Assert
      // Failing soft is only recoverable if somebody can find out it happened.
      expect(markers[0]!.actions).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  it("omits an absent action style rather than inventing one", async () => {
    // Arrange
    arrange([
      place({
        actions: [
          {
            id: "reward",
            label: { ko: "리워드 안내" },
            actionType: "content",
            actionValue: "도장을 모아 오세요.",
          },
        ],
      }),
    ]);

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    expect("style" in markers[0]!.actions[0]!).toBe(false);
  });
});

/**
 * A zone is a place whose geometry happens to be an area. Nothing about the
 * pipeline is special-cased for it — same collection, same activation, same
 * cursor, same category table — which is the property these cases pin.
 */
describe("MapEventService.getEventOverlays — zones and route lines", () => {
  const RING: [number, number][] = [
    [126.9714, 37.2944],
    [126.9724, 37.2944],
    [126.9724, 37.2954],
    [126.9714, 37.2954],
    [126.9714, 37.2944],
  ];

  it("draws a Polygon place as a polygon, from the same cursor as the pins", async () => {
    // Arrange
    arrange([
      place(),
      place({
        _id: "eskara-2026-zone-01",
        location: { type: "Polygon", coordinates: [RING] },
      }),
    ]);

    // Act
    const { overlays } = await getEventOverlays();

    // Assert
    expect(overlays.map((o) => o.kind).sort()).toEqual(["marker", "polygon"]);
    const zone = overlays.find((o) => o.kind === "polygon")!;
    // Verbatim. The server converts nothing, so this is identity.
    expect(zone.geometry).toEqual({ type: "Polygon", coordinates: [RING] });
  });

  it("rewinds a clockwise ring on the way to the wire", async () => {
    // Arrange
    // Authored or hand-edited the wrong way round. Mongo accepts it silently,
    // so the projection is the only place this can be caught.
    const backwards = [...RING].reverse();
    arrange([
      place({
        _id: "eskara-2026-zone-01",
        location: { type: "Polygon", coordinates: [backwards] },
      }),
    ]);

    // Act
    const { overlays } = await getEventOverlays();
    const zone = overlays[0]!;

    // Assert
    expect(zone.kind).toBe("polygon");
    if (zone.kind === "polygon") {
      expect(zone.geometry.coordinates[0]).toEqual(RING);
    }
  });

  it("draws a LineString place as a path", async () => {
    // Arrange
    arrange([
      place({ _id: "eskara-2026-route-01", location: { type: "LineString", coordinates: RING } }),
    ]);

    // Act
    const { overlays } = await getEventOverlays();

    // Assert
    expect(overlays[0]!.kind).toBe("path");
  });

  it("gives a zone the same tap envelope a booth gets", async () => {
    // Arrange
    arrange([
      place({ _id: "eskara-2026-zone-01", location: { type: "Polygon", coordinates: [RING] } }),
    ]);

    // Act
    const { overlays } = await getEventOverlays();

    // Assert
    expect(overlays[0]!.tap).toEqual({
      kind: "event",
      placeId: "eskara-2026-zone-01",
    });
  });

  it("skips a structurally broken ring instead of 500ing the festival", async () => {
    // Arrange
    // `coordinates: [null]` satisfies "is an array" and then dereferences
    // null.length inside the winding pass. This route has no try/catch, so
    // without a structural guard one hand-edited document takes the whole
    // festival down for every client for as long as the row exists.
    arrange([
      place(),
      place({
        _id: "eskara-2026-broken-01",
        location: { type: "Polygon", coordinates: [null] },
      }),
    ]);

    // Act
    const { overlays } = await getEventOverlays();

    // Assert
    expect(overlays).toHaveLength(1);
    expect(overlays[0]!.id).toBe("eskara-2026-booth-01");
  });

  it("skips a ring too short to bound an area", async () => {
    // Arrange
    arrange([
      place({
        _id: "eskara-2026-thin-01",
        location: { type: "Polygon", coordinates: [[RING[0], RING[1], RING[0]]] },
      }),
    ]);

    // Act & Assert
    await expect(getEventOverlays()).resolves.toEqual({ overlays: [] });
  });

  it("skips a geometry this build has no renderer for, and counts it", async () => {
    // Arrange
    // A MultiPolygon typed straight into Mongo. Fail SOFT: it is content, so
    // one bad row must not take the other sixty with it — but it must not be
    // silent either, or a booth goes missing with nothing saying why.
    arrange([
      place(),
      place({
        _id: "eskara-2026-bad-01",
        location: { type: "MultiPolygon", coordinates: [[RING]] },
      }),
    ]);

    // Act
    const { overlays } = await getEventOverlays();

    // Assert
    expect(overlays).toHaveLength(1);
    expect(overlays[0]!.id).toBe("eskara-2026-booth-01");
    expect(logText(mockLogger.warn.mock.calls.at(-1))).toMatch(/not renderable/);
  });
});

describe("MapEventService.getEventOverlays — list facets", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<MapRepository["findActiveActivation"]>>);
  });

  /** KST wall-clock → a window starting then, one hour long. */
  const at = (kst: string) => {
    const startAt = new Date(`${kst}+09:00`);
    return { startAt, endAt: new Date(startAt.getTime() + 3_600_000) };
  };

  async function facetsFor(over: Record<string, unknown>) {
    arrange([place(over)]);
    const { overlays } = await getEventOverlays();
    return overlays[0]!;
  }

  it("puts a one-night pub on its night only", async () => {
    // Act
    const o = await facetsFor({ hours: [at("2026-10-02T18:00:00")] });

    // Assert
    expect(o.facets.day).toEqual(["day2"]);
  });

  it("puts a pub open both nights under both days — the council's 양일 rule", async () => {
    // Act
    const o = await facetsFor({ hours: [at("2026-10-01T18:00:00"), at("2026-10-02T18:00:00")] });

    // Assert
    expect(o.facets.day).toEqual(["day1", "day2"]);
  });

  it("keeps a window running past midnight on the night it opened", async () => {
    // Act
    // 23:00 → 02:00 overlaps day2's window; only the START decides.
    const o = await facetsFor({
      hours: [{ startAt: new Date("2026-10-01T23:00:00+09:00"), endAt: new Date("2026-10-02T02:00:00+09:00") }],
    });

    // Assert
    expect(o.facets.day).toEqual(["day1"]);
  });

  it("treats each day's window as half-open at the cut-over", async () => {
    // Act & Assert
    expect((await facetsFor({ hours: [at("2026-10-02T05:59:59")] })).facets.day).toEqual(["day1"]);
    clearEventOverlaysCache();
    expect((await facetsFor({ hours: [at("2026-10-02T06:00:00")] })).facets.day).toEqual(["day2"]);
  });

  it("puts an always-open place in every day", async () => {
    // Act
    const o = await facetsFor({ hours: [] });

    // Assert
    expect(o.facets.day).toEqual(["day1", "day2"]);
  });

  it("puts a place outside every day in none — still served, just in no day tab", async () => {
    // Act
    const o = await facetsFor({ hours: [at("2026-10-03T11:00:00")] });

    // Assert
    expect(o.facets.day).toEqual([]);
  });

  it("carries an authored tag through, and keys every facet even when untagged", async () => {
    // Act & Assert
    expect((await facetsFor({ facets: { org: ["council"] } })).facets).toEqual({
      day: ["day1", "day2"],
      org: ["council"],
    });
    clearEventOverlaysCache();
    expect((await facetsFor({})).facets.org).toEqual([]);
  });

  it("drops and logs a tag the config does not offer, keeping the rest", async () => {
    // Act
    const o = await facetsFor({ facets: { org: ["council", "sponsor", "council"], price: ["cheap"] } });

    // Assert
    expect(o.facets.org).toEqual(["council"]);
    expect(o.facets).not.toHaveProperty("price");
    const message = logText(mockLogger.warn.mock.calls.at(-1));
    expect(message).toMatch(/facets\.org has no option "sponsor"/);
    expect(message).toMatch(/facets\.price is not a facet/);
  });

  it("ignores a hand-authored day — the day comes from hours, never twice", async () => {
    // Act
    const o = await facetsFor({ hours: [at("2026-10-01T18:00:00")], facets: { day: ["day2"] } });

    // Assert
    expect(o.facets.day).toEqual(["day1"]);
    expect(logText(mockLogger.warn.mock.calls.at(-1))).toMatch(/facets\.day is derived from hours/);
  });

  it("carries orderByOption through, dropping keys that name no option and non-numbers", async () => {
    // Act
    const o = await facetsFor({ orderByOption: { day1: 3, day2: 11, day3: 1, org: 2, council: "x" } });

    // Assert
    expect(o.orderByOption).toEqual({ day1: 3, day2: 11 });
    expect(logText(mockLogger.warn.mock.calls.at(-1))).toMatch(/orderByOption\.day3/);
  });

  it("does not choke on a malformed facets value typed straight into Mongo", async () => {
    // Act
    const o = await facetsFor({ facets: { org: "council" }, orderByOption: [1, 2] });

    // Assert
    expect(o.facets.org).toEqual([]);
    expect(o.orderByOption).toEqual({});
  });
});
