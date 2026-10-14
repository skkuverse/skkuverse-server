---
title: Map Code Map
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-11
audience: internal
---

# Map Code Map

> Where each part of `src/map/` lives, what runs at boot and what per request, which test pins what, and what to touch for each change. Why the module is shaped this way is [explanation/map-architecture.md](../explanation/map-architecture.md); the wire contract is [reference/map-overlays-api.md](map-overlays-api.md).

## Folders

Read them in this order: each depends only on the ones before it.

| Folder | Holds |
| --- | --- |
| `src/map/` (root) | `MapModule` (the `/map` limiter), `MapRepository` (places, activations, their indexes), the stored documents, `BASE_LAYERS` and the other constants, the overlay wire both overlay routes share, the place schemas (`overlayPlaceDoc`, `sheetPlaceDoc`), `presentationFor`, `toI18nText`, `toOverlay`, `toServedWebviewUrl` |
| `src/map/layer-set/` | The festival structure tier: the layer-set JSON files, their loader (`map-layer-set.config.ts`) and schema, the cross-reference rules, the chip validator, the festival layer and chip specs, and `MapLayerSetService`, which answers which layer set is live |
| `src/map/config/` | `GET /map/config`: campuses, layers, chips and camera defaults |
| `src/map/campus/` | `GET /map/overlays/campus`: buildings and campus shapes, the static fallback, and the Cache-Control that refuses to cache it |
| `src/map/event/` | `GET /map/overlays/event`: a festival's places as overlays |
| `src/map/event-details/` | `GET /map/overlays/event/details`: the sheet behind each event overlay |

The layer-set loader imports the root's and its own rules, mappers, schemas, constants and types at load, so none of them may import it back; `eslint.config.js` (block `layer-set-leaves`) refuses that import.

## Boot time and request time

| When | What runs | If it fails |
| --- | --- | --- |
| import | Base chips checked against the base layers (`assertValidChipSpecs`) | The boot stops: repository code, a PR fixes it |
| import | Every file in `LAYER_SET_FILES` read, checked, frozen | Logged and skipped; the base map keeps serving |
| boot | `MapRepository.ensureIndexes` on `places` and `activations` | Logged; the boot does not wait for it |
| per request | The live layer set: the cached activation, checked against the clock | Caught in `/map/config`, which serves the base layers |
| per request | Layers and chips built, labels resolved to the request language | — |
| per `EVENT_CACHE_TTL_MS` | Places read by layer set and projected to overlays and sheets | An unrenderable place, a bad button, block or facet value is dropped and logged |

## Tests

| Test | Pins |
| --- | --- |
| `src/map/layer-set/map-layer-set.config.spec.ts` | Every layer-set rejection, by its exact message |
| `src/map/layer-set/map-layer-set.service.spec.ts` | The live-event answer, its cache and stale window, and the once-per-process warning |
| `src/map/layer-set/map-layer-set.rules.spec.ts`, `src/map/layer-set/map-layer-set.mapper.spec.ts`, `src/map/config/map-config.mapper.spec.ts`, `__tests__/nest/map/map-chips-wire.test.ts` | The chip group rules; the reset chip and the shipped chip row; the chips as served |
| `src/map/config/map-config.service.spec.ts` | The `/map/config` body with and without a festival |
| `src/map/event/map-event.service.spec.ts`, `__tests__/nest/map/map-overlay-coordinates.test.ts` | The event projection, the unrenderable-place skip, `[lng, lat]` order |
| `__tests__/nest/map/map-overlay-interactive.test.ts` | `interactive: false`, `tapChip`, and one layer holding all three kinds |
| `src/map/event-details/map-event-details.service.spec.ts` | The sheet projection and every drop |
| `src/map/campus/map-campus.service.spec.ts` | Both building layers, the campus shapes, the degraded fallback |
| `src/map/map.repository.spec.ts` | The activation query, its sort, and the three indexes on the right collections |
| `src/map/map.schema.spec.ts`, `src/map/event/map-event.mapper.spec.ts` | The place schemas agreeing with the places importer; the overlay read refusing exactly the places drawing would throw on |
| `__tests__/nest/map/map.routes.test.ts` | The four routes through the production pipeline: envelope, Cache-Control, the retired URLs |
| `__tests__/nest/map/map-places-import.test.ts`, `map-place-detail-import.test.ts`, `campus-shapes-import.test.ts`, `eventmap-db.test.ts` | The importers and the committed sheets |
| `__tests__/nest/map/map-config-assets.test.ts` | Every declared layer set is also in the build-asset copy list |

## Change map

| To do this | Touch | Deploy? |
| --- | --- | --- |
| Take the festival down now | `activations` document → `enabled: false` | No |
| Move a place, fix a title, add a sheet button | `places`, through `npm run eventmap:import` | No; live within the event routes' TTL |
| Change festival dates | `activations` → `activeFrom` / `activeUntil` | No |
| Add a building footprint, a boundary, a path | `scripts/data/campus-shapes.json` → `npm run campus:shapes` | No |
| Change a place's menu, photos or notices | upload photos to R2 first, then the sheet's `detail` → `npm run eventmap:import` | No |
| Make a category a backdrop, run a chip on tap, or name an area | the layer-set JSON → `itemDefaults` (`interactive`, `tapChip`, `locationAccuracy`) | Yes; a new tap or field also needs an app release |
| Add, rename or recolour a festival layer, add a chip, map a category | the layer-set JSON → `layers`, `chips`, `itemDefaults.byCategory` | Yes |
| Add next year's festival | a new JSON in `src/map/layer-set/`, `LAYER_SET_FILES`, and `scripts/copy-build-assets.js` | Yes; three edits, and a missed third breaks production only |
| Add a permanent chip | `BASE_CHIPS` in `map-layer-set.constants.ts` | Yes |
| Change how a pin or zone is drawn | `BASE_LAYERS[].style`, `EVENT_LAYER_STYLE`, `EVENT_SHAPE_STYLE` | Yes |
| Add a field to every overlay | `map.wire.ts`, then every producer (`map-campus.mapper.ts`, `map-event.mapper.ts`) | Yes, plus an app release |
| Add a sheet block type | `map-event-details.wire.ts`, `map-event-details.mapper.ts`, the importer's copy, an app renderer | Yes, plus an app release; older builds drop it |
| Add an overlay kind | an arm in `mapOverlay`, a producer branch, an app renderer | Yes, plus an app release |
