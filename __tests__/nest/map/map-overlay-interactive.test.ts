/**
 * `interactive: false` — how a zone is drawn without becoming a tap target.
 *
 * Its own file because it needs a layer set revision 1 of `map-layer-sets` does
 * not describe, so the live layer set is stubbed wholesale rather than read
 * from the stored dataset's fixture as `src/map/event/map-event.service.spec.ts`
 * does.
 *
 * The behaviour matters because the alternative shapes were both worse. A
 * per-place flag would sit beside a populated `fields` array, giving the
 * meaningless combination "card rows nobody can open". Deriving it from "has no
 * fields or actions" would mean adding one card row silently turns a backdrop
 * into a button.
 */
jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { MiniappsService } from "../../../src/miniapps/miniapps.service";
import { MapEventService } from "../../../src/map/event/map-event.service";
import type { LayerSet } from "../../../src/map/layer-set/map-layer-set.schema";
import type { MapLayerSetService } from "../../../src/map/layer-set/map-layer-set.service";
import type { MapPlaceDoc } from "../../../src/map/map.document";
import type { MapRepository } from "../../../src/map/map.repository";
import { asReal } from "../../helpers/fakes/public-of";
import { FakeMapRepository } from "../../helpers/fakes/map/map.repository.fake";

const mockLiveLayerSet = jest.fn<Promise<LayerSet | null>, []>();
let repository: FakeMapRepository;
let service: MapEventService;
const getEventOverlays = () => service.getEventOverlays();

// The event read path is cached per service; each test starts cold.
beforeEach(() => {
  repository = new FakeMapRepository();
  const layerSet = { liveLayerSet: mockLiveLayerSet } as unknown as MapLayerSetService;
  service = new MapEventService(asReal<MapRepository>(repository), layerSet, new MiniappsService());
});

const RING: [number, number][] = [
  [126.9714, 37.2944],
  [126.9724, 37.2944],
  [126.9724, 37.2954],
  [126.9714, 37.2954],
  [126.9714, 37.2944],
];

/** Three categories on ONE layer: one tappable, one a backdrop, one that runs a chip. */
const CONFIG = {
  layerSetId: "test-set",
  facets: [],
  itemDefaults: {
    byCategory: {
      zone: { layerId: "test_zones", pinPriority: 0, interactive: true, tapChip: null },
      "zone-bg": { layerId: "test_zones", pinPriority: 0, interactive: false, tapChip: null },
      "zone-chip": { layerId: "test_zones", pinPriority: 0, interactive: true, tapChip: "view_zones" },
    },
    fallback: { layerId: "test_zones", pinPriority: 0, interactive: true, tapChip: null },
  },
} as unknown as LayerSet;

function place(id: string, category: string) {
  return {
    _id: id,
    layerSetId: "test-set",
    campus: "nsc",
    category,
    location: { type: "Polygon", coordinates: [RING] },
    title: { ko: "구역", en: "Zone" },
    subtitle: null,
    hours: [],
    fields: [{ label: { ko: "라벨" }, value: { ko: "값" } }],
    actions: [],
    order: 0,
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLiveLayerSet.mockResolvedValue(CONFIG);
  repository.places = [
    place("z-tappable", "zone"),
    place("z-backdrop", "zone-bg"),
    place("z-chip", "zone-chip"),
  ] as unknown as MapPlaceDoc[];
});

describe("interactive", () => {
  it("gives an interactive category the ordinary event tap", async () => {
    // Act
    const { overlays } = await getEventOverlays();
    const tappable = overlays.find((o) => o.id === "z-tappable")!;

    // Assert
    expect(tappable.tap).toEqual({ kind: "event", placeId: "z-tappable" });
  });

  it("makes an inert category a backdrop with tap: null", async () => {
    // Act
    const { overlays } = await getEventOverlays();
    const backdrop = overlays.find((o) => o.id === "z-backdrop")!;

    // Assert
    // `tap: null` is a spelling that already existed for a marker with nothing
    // to open, so background geometry needs no new field on the wire.
    expect(backdrop.tap).toBeNull();
  });

  it("still draws and still carries its card rows", async () => {
    // Act
    const { overlays } = await getEventOverlays();
    const backdrop = overlays.find((o) => o.id === "z-backdrop")!;

    // Assert
    // Inert governs the TAP, not the drawing and not the content. A backdrop is
    // on the map and in the layer exactly like its neighbour.
    expect(backdrop.kind).toBe("polygon");
    expect(backdrop.layerId).toBe("test_zones");
    expect(backdrop.fields).toHaveLength(1);
  });

  it("lets one layer hold both, which is why the flag is per category", async () => {
    // Act
    const { overlays } = await getEventOverlays();

    // Assert
    expect(overlays.map((o) => o.layerId)).toEqual(["test_zones", "test_zones", "test_zones"]);
    expect(overlays.map((o) => o.tap === null)).toEqual([false, true, false]);
  });
});

describe("tapChip", () => {
  it("makes a tap run the named chip instead of opening the place", async () => {
    // Act
    const { overlays } = await getEventOverlays();
    const zone = overlays.find((o) => o.id === "z-chip")!;

    // Assert
    // No placeId: the 푸드트럭 구역 is a way into a list, not a place with a sheet.
    expect(zone.tap).toEqual({ kind: "chip", chipId: "view_zones" });
    expect(zone.kind).toBe("polygon");
  });

  it("leaves the categories without one on the ordinary event tap", async () => {
    // Act
    const { overlays } = await getEventOverlays();

    // Assert
    expect(overlays.find((o) => o.id === "z-tappable")!.tap).toEqual({
      kind: "event",
      placeId: "z-tappable",
    });
  });
});
