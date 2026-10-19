/**
 * Importer → projection round trip, against the REAL surveyed sheet.
 *
 * Every other test of the event projection invents its documents — and an
 * invented document cannot catch a `[lng, lat]` swap, because whatever order
 * the fixture was written in is the order the assertion expects.
 *
 * This one closes that gap without a database. It parses
 * `scripts/data/eskara-2026-places.json` with the same reader the ops importer
 * uses, feeds the resulting documents straight into the marker projection, and
 * checks the emitted `lat`/`lng` against the sheet's own columns. A swap on
 * either side of that seam fails here — and there are now TWO conversions to
 * catch, named lat/lng → GeoJSON on the way in and back again on the way out.
 *
 * It matters because a swap is otherwise invisible: it raises no error, passes
 * every type check, and simply puts 61 booths in the Gulf of Guinea.
 */

import fs from "fs";
import path from "path";

import type { Clock } from "../../../src/infra/clock";
import { fixtureMiniAppIds, fixtureMiniappsService } from "../../helpers/miniapps/registry-fixture";
import { MapEventService } from "../../../src/map/event/map-event.service";
import { MapLayerSetService } from "../../../src/map/layer-set/map-layer-set.service";
import type { MapLayerSetRepository } from "../../../src/map/layer-set/map-layer-set.repository";
import { fixtureLayerSetRepository } from "../../helpers/map/layer-sets-fixture";
import type { MapPlaceDoc } from "../../../src/map/map.document";
import type { MapRepository } from "../../../src/map/map.repository";
import { FakeMapRepository } from "../../helpers/fakes/map/map.repository.fake";
import { asReal } from "../../helpers/fakes/public-of";

const CLOCK: Clock = { now: () => new Date("2026-10-01T03:00:00.000Z") };

// The live activation, stated per test; the fake answers with it.
const mockFindActiveActivation = jest.fn<ReturnType<MapRepository["findActiveActivation"]>, [Date]>();

let repository: FakeMapRepository;
let service: MapEventService;
const getEventOverlays = () => service.getEventOverlays();

// The event read path is cached per service; each test starts cold.
beforeEach(() => {
  repository = new FakeMapRepository();
  repository.findActiveActivation = mockFindActiveActivation;
  const real = asReal<MapRepository>(repository);
  const layerSet = new MapLayerSetService(real, asReal<MapLayerSetRepository>(fixtureLayerSetRepository()), CLOCK);
  service = new MapEventService(real, layerSet, fixtureMiniappsService());
});

// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import — same as map-places-import.test.ts.
const { parsePlacesFile } = require("../../../scripts/lib/map-places-file");

const REAL_FILE = path.join(
  __dirname,
  "../../../scripts/data/eskara-2026-places.json",
);

const LAYER_SET_ID = "eskara-2026";

/**
 * What the sheet authored for each place, keyed by the id the projection emits.
 *
 * Either a named `lat`/`lng` pair or a pasted `geometry` — never both, which the
 * reader enforces. Both forms are carried because the wire assertion below has
 * to check a different thing for each.
 */
type Authored = { lat?: number; lng?: number; geometry?: WireGeometry };

function sheetCoordsById(): Map<string, Authored> {
  const raw = JSON.parse(fs.readFileSync(REAL_FILE, "utf8"));
  const out = new Map<string, Authored>();
  for (const place of raw.places) {
    out.set(`${LAYER_SET_ID}-${place.id}`, {
      lat: place.lat,
      lng: place.lng,
      geometry: place.geometry,
    });
  }
  return out;
}

type WireGeometry = { type: string; coordinates: unknown };

/**
 * The same geometry with every ring reversed.
 *
 * The ONE transform the projection is allowed to apply: `toWirePolygon`
 * normalises a ring to RFC 7946 §3.1.6 winding, so a clockwise paste comes back
 * reversed. Nothing else about the positions may change, which is why the
 * assertion below compares against exactly these two candidates rather than
 * sorting the positions — a sort would also accept a shape whose vertices were
 * shuffled into a different polygon entirely.
 */
function rewound(geometry: WireGeometry): WireGeometry {
  if (geometry.type !== "Polygon") return geometry;
  return {
    type: "Polygon",
    coordinates: (geometry.coordinates as [number, number][][]).map((ring) =>
      [...ring].reverse(),
    ),
  };
}

/**
 * Every position an overlay carries, flattened. Works for a Point, a LineString
 * and a Polygon's rings alike, so the peninsula check below does not have to
 * branch on `kind` — and so a new geometry arm is covered the day it lands.
 */
function positionsOf(overlay: { geometry: { coordinates: unknown } }): [number, number][] {
  const flat = (overlay.geometry.coordinates as unknown[]).flat(2) as number[];
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

describe("event overlay coordinates, end to end from the survey sheet", () => {
  it("emits every place at the coordinates the sheet recorded", async () => {
    // Arrange
    const raw = fs.readFileSync(REAL_FILE, "utf8");
    const { docs, errors } = parsePlacesFile(raw, { layerSetId: LAYER_SET_ID, miniAppIds: fixtureMiniAppIds() });

    // If the committed sheet stops parsing, that is its own bug — fail loudly
    // rather than silently testing zero rows.
    expect(errors).toEqual([]);
    expect(docs.length).toBeGreaterThan(50);

    mockFindActiveActivation.mockResolvedValue({ _id: LAYER_SET_ID } as Awaited<
      ReturnType<MapRepository["findActiveActivation"]>
    >);
    repository.places = docs as MapPlaceDoc[];

    // Act
    const { overlays: markers } = await getEventOverlays();
    const expected = sheetCoordsById();

    // Assert
    expect(markers).toHaveLength(docs.length);

    for (const marker of markers) {
      const ref = expected.get(marker.id)!;
      expect(ref).toBeDefined();
      // The stored geometry object reaches the wire BY REFERENCE — no
      // conversion on the server at all — so this is an identity check rather
      // than a tolerance one. Anything but equality means somebody
      // reintroduced a transform, which is where a swap comes from.
      if (ref.geometry) {
        // A pasted ring is the same object, EXCEPT that winding is normalised
        // on the way out. The committed sheet holds one ring of each direction,
        // so both branches are exercised rather than merely allowed for.
        expect([ref.geometry, rewound(ref.geometry)]).toContainEqual(marker.geometry);
      } else {
        expect(marker.geometry).toEqual({
          type: "Point",
          coordinates: [ref.lng, ref.lat],
        });
      }
    }
  });

  it("puts every overlay on the Korean peninsula, not in the ocean", async () => {
    // Arrange
    const raw = fs.readFileSync(REAL_FILE, "utf8");
    const { docs } = parsePlacesFile(raw, { layerSetId: LAYER_SET_ID, miniAppIds: fixtureMiniAppIds() });

    mockFindActiveActivation.mockResolvedValue({ _id: LAYER_SET_ID } as Awaited<
      ReturnType<MapRepository["findActiveActivation"]>
    >);
    repository.places = docs as MapPlaceDoc[];

    // Act
    const { overlays: markers } = await getEventOverlays();

    // Assert
    // The blunt version of the same check, and the one that would survive a
    // rewrite of everything above: a swap sends lat to ~126, which is not a
    // latitude South Korea has. 자과캠 sits near 37.29 N, 126.97 E.
    //
    // It matters MORE for rings than it did for pins. A pin in the ocean is one
    // wrong dot; a swapped 30-vertex zone is a shape drawn across the Yellow
    // Sea, and neither Mongo nor the type system says a word about either.
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      for (const [lng, lat] of positionsOf(m)) {
        expect(lat).toBeGreaterThan(33);
        expect(lat).toBeLessThan(39);
        expect(lng).toBeGreaterThan(124);
        expect(lng).toBeLessThan(132);
      }
    }
  });
});
