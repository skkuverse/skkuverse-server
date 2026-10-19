---
title: Map Code Map
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-20
audience: internal
---

# Map Code Map

> Where each part of `src/map/` lives, what runs at boot and what per request, which test pins what, and what to touch for each change. Why the module is shaped this way is [explanation/map-architecture.md](../explanation/map-architecture.md); the wire contract is [reference/map-overlays-api.md](map-overlays-api.md).

## Folders

Read them in this order: each depends only on the ones before it.

| Folder | Holds |
| --- | --- |
| `src/map/` (root) | `MapModule` (the `/map` limiter), `MapRepository` (places, activations, their indexes), the stored documents, `BASE_LAYERS` and the other constants, the overlay wire both overlay routes share, the place schemas (`overlayPlaceDoc`, `sheetPlaceDoc`), `presentationFor`, `toI18nText`, `toOverlay` |
| `src/map/layer-set/` | The festival structure tier: `MapLayerSetRepository`, which reads the `map-layer-sets` dataset, the layer set's schemas (one set, the dataset, the stored envelope), the cross-reference rules, the chip validator, the festival layer and chip specs, and `MapLayerSetService`, which answers which layer set is live. `map-layer-set.config.ts` and `eskara-2026.json`, the committed file and its loader, stay for the specs until they are deleted |
| `src/map/config/` | `GET /map/config`: campuses, layers, chips and camera defaults |
| `src/map/campus/` | `GET /map/overlays/campus`: buildings and campus shapes, the static fallback, and the Cache-Control that refuses to cache it |
| `src/map/transit/` | `GET /map/overlays/transit`: the Jongno route lines `BusRoutePathService` answers, as path overlays, and the shorter Cache-Control when a route has no stored line |
| `src/map/event/` | `GET /map/overlays/event`: a festival's places as overlays |
| `src/map/event-details/` | `GET /map/overlays/event/details`: the sheet behind each event overlay |

The committed-file loader imports the root's and its own rules, mappers, schemas, constants and types at load, so none of them may import it back; `eslint.config.js` (block `layer-set-leaves`) refuses that import.

## Boot time and request time

| When | What runs | If it fails |
| --- | --- | --- |
| boot | Base chips checked against the base layers (`assertValidChipSpecs`) and the mini-app registry (`assertValidLinkChips`), when Nest builds `MapLayerSetService` | The boot stops: repository code, a PR fixes it |
| boot | `MapRepository.ensureIndexes` on `places` and `activations` | Logged; the boot does not wait for it |
| per request | The live layer set: the cached activation, checked against the clock | Caught in `/map/config`, which serves the base layers |
| per `DATASET_CACHE_TTL_MS`, only while an activation is live | `map-layer-sets` read, each set checked on its own | A bad or repeated set is left out and logged once per revision; with no good value ever read, the base map serves and the event routes serve nothing |
| per request | Layers and chips built, labels resolved to the request language | — |
| per `EVENT_CACHE_TTL_MS` | Places read by layer set and projected to overlays and sheets | An unrenderable place, a bad button, block or facet value is dropped and logged |

## Tests

| Test | Pins |
| --- | --- |
| `src/map/layer-set/map-layer-set.schema.spec.ts` | Every layer-set rejection, at its path; the dataset's unique ids; the stored envelope, set by set |
| `src/map/layer-set/map-layer-set.repository.spec.ts`, `__tests__/nest/map/map-layer-sets-dataset.test.ts` | The dataset read's query, the left-out sets and their logs; the round trip from `npm run data`'s store |
| `src/map/layer-set/map-layer-set.service.spec.ts` | The live-event answer, the dataset TTL, the unservable and unavailable logs, the activation cache and its stale window |
| `__tests__/nest/map/map-layer-set-characterization.routes.test.ts` | `/map/config` and both event routes, byte for byte, at the production capture and inside the eskara-2026 window |
| `src/map/layer-set/map-layer-set.config.spec.ts` | The committed file's loader, by its exact messages, until it is deleted |
| `src/map/layer-set/map-layer-set.rules.spec.ts`, `src/map/layer-set/map-layer-set.mapper.spec.ts`, `src/map/config/map-config.mapper.spec.ts`, `__tests__/nest/map/map-chips-wire.test.ts` | The chip group rules; the reset chip and the shipped chip row; the chips as served |
| `src/map/config/map-config.service.spec.ts` | The `/map/config` body with and without a festival |
| `src/map/event/map-event.service.spec.ts`, `__tests__/nest/map/map-overlay-coordinates.test.ts` | The event projection, the unrenderable-place skip, `[lng, lat]` order |
| `__tests__/nest/map/map-overlay-interactive.test.ts` | `interactive: false`, `tapChip`, and one layer holding all three kinds |
| `src/map/event-details/map-event-details.service.spec.ts` | The sheet projection and every drop |
| `src/map/campus/map-campus.service.spec.ts` | Both building layers, the campus shapes, the degraded fallback |
| `src/map/transit/map-transit.mapper.spec.ts`, `src/map/transit/map-transit.service.spec.ts`, `__tests__/nest/map/map-transit.routes.test.ts` | One path per route on its route line layer, the geometry as stored, both Cache-Control values, the opt-in layers in `/map/config`, the limiter |
| `src/map/map.repository.spec.ts` | The activation query, its sort, and the three indexes on the right collections |
| `src/map/map.schema.spec.ts`, `src/map/event/map-event.mapper.spec.ts` | The place schemas agreeing with the places importer; the overlay read refusing exactly the places drawing would throw on |
| `__tests__/nest/map/map.routes.test.ts` | The config, campus and event routes through the production pipeline: envelope, Cache-Control, the retired URLs, the base map with no layer set read, a festival pushed with no restart, the ETag across revisions |
| `__tests__/nest/map/map-places-import.test.ts`, `map-place-detail-import.test.ts`, `campus-shapes-import.test.ts`, `eventmap-db.test.ts` | The importers and the committed sheets |
| `__tests__/nest/map/map-config-assets.test.ts` | The committed layer set is also in the build-asset copy list, until it is deleted |

## Change map

| To do this | Touch | Deploy? |
| --- | --- | --- |
| Take the festival down now | `activations` document → `enabled: false` | No |
| Move a place, fix a title, add a sheet button | `places`, through `npm run eventmap:import` | No; live within the event routes' TTL |
| Change festival dates | `activations` → `activeFrom` / `activeUntil` | No |
| Add a building footprint, a boundary, a path | `scripts/data/campus-shapes.json` → `npm run campus:shapes` | No |
| Change a place's menu, photos or notices | upload photos to R2 first, then the sheet's `detail` → `npm run eventmap:import` | No |
| Make a category a backdrop, run a chip on tap, or name an area | the layer set in `map-layer-sets` → `itemDefaults` (`interactive`, `tapChip`, `locationAccuracy`), with `npm run data` | No; a new tap or field needs a deploy and an app release |
| Add, rename or recolour a festival layer, add a chip, map a category | the layer set in `map-layer-sets` → `layers`, `chips`, `itemDefaults.byCategory`, with `npm run data` | No |
| Add next year's festival | a new entry in `map-layer-sets` (`npm run data`), its places, then its window ([configure map overlays](../how-to/configure-map-overlays.md#add-or-edit-a-festival)) | No |
| Remove a festival's layer set | close its window first, then push `map-layer-sets` without it | No |
| Add a permanent chip | `BASE_CHIPS` in `map-layer-set.constants.ts` | Yes |
| Change how a pin or zone is drawn | `BASE_LAYERS[].style`, `EVENT_LAYER_STYLE`, `EVENT_SHAPE_STYLE` | Yes |
| Recolour the Jongno route lines, change which one lies on top, or turn them on by default | `ROUTE_LINE_LAYER` in `map.constants.ts` (one style in the routes' `themeColor`, and the default), the order of their `BASE_LAYERS` entries | Yes; the default reaches installed apps with the next `/map/config` |
| Fix a Jongno route's geometry | nothing in `src/map/`: `src/bus/route-path/` syncs it from TOPIS daily ([configure map overlays](../how-to/configure-map-overlays.md)) | No |
| Add a field to every overlay | `map.wire.ts`, then every producer (`map-campus.mapper.ts`, `map-event.mapper.ts`) | Yes, plus an app release |
| Add a sheet block type | `map-event-details.wire.ts`, `map-event-details.mapper.ts`, the importer's copy, an app renderer | Yes, plus an app release; older builds drop it |
| Add an overlay kind | an arm in `mapOverlay`, a producer branch, an app renderer | Yes, plus an app release |
