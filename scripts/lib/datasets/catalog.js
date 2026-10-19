/**
 * The datasets `npm run data` knows, and the server code that validates each
 * one (openspec/changes/archive/2026-10-19-move-runtime-data-to-db, design D1 and D6).
 *
 * `loadCatalog(load)` takes a loader of server modules by their path under
 * src/, without an extension: scripts/data.js passes one that requires the
 * compiled dist/src/<path>.js, and the tests pass one that requires src/<path>
 * through ts-jest. So the catalog the tests cover is the catalog the tool runs,
 * and the tool validates with the very schema and rules the server parses with.
 *
 * Nothing loaded here may import src/infra/config.ts: it exits on a missing
 * value and picks `_dev` from NODE_ENV, while the tool picks its database from
 * `--prod`. __tests__/nest/infra/data-tool-catalog.test.ts pins that.
 *
 * A dataset entry:
 *
 *   owner            the src/ folder that reads it
 *   schema           the zod schema the server's repository parses `data` with
 *   issuesOf(data)   checks a schema cannot hold, as { path, message }
 *   referencesOf(data)
 *                    every identity the data names, as { dataset, id, path };
 *                    `dataset` is another catalog dataset or a code-held source
 *   idsOf(data)      the identities others may reference (`map-layer-sets`
 *                    names its layer sets; nothing references them yet)
 *
 * `issuesOf`, `referencesOf` and `idsOf` take the schema's parsed output.
 *
 * A code-held source is an identity list that still lives in code, resolved
 * against the compiled checkout (move-editorial-datasets D3):
 *
 *   owner            the src/ folder that holds the list
 *   has(id)          whether the checkout serves `id`
 *   ids()            every id it serves, in the server's order: a check that
 *                    needs the whole list (an unplaced id) reads it here
 *
 * The lists are the ones the server checks against: `busGroups` is
 * BusConfigService.listGroupIds's `toBusGroupIds(jongroRoutes)`,
 * `subwayStations` SubwayStationsService.listStations's ids, `busServices`
 * the keys of SERVICE_CONFIG.
 */

function codeHeldSource(owner, ids) {
  const known = new Set(ids);
  return { owner, has: (id) => known.has(id), ids: () => [...ids] };
}

function loadCatalog(load) {
  const { homeLayoutFile } = load("ui/home/ui-home.schema");
  const { homeLayoutReferences, toHomeLayoutIssues } = load("ui/home/ui-home.rules");
  const { campusBannersFile } = load("ui/campus/ui-campus.schema");
  const { campusBannerReferences, toCampusBannerIssues } = load("ui/campus/ui-campus.rules");
  const { transitLayoutFile } = load("ui/transit/ui-transit.schema");
  const { toTransitLayoutIssues, transitLayoutReferences } = load("ui/transit/ui-transit.rules");
  const { layerSetsDataset } = load("map/layer-set/map-layer-set.schema");
  const { busServiceNoticesDataset, skkuRestDaysDataset } = load("bus/schedule-content/bus-schedule-content.schema");
  const { serviceNoticesReferences } = load("bus/schedule-content/bus-schedule-content.rules");
  const { MiniappsService } = load("miniapps/miniapps.service");
  const { jongroRoutes } = load("bus/bus.config");
  const { SERVICE_CONFIG } = load("bus/bus.constants");
  const { toBusGroupIds } = load("bus/config/bus-config.mapper");
  const { SubwayStationsService } = load("subway/stations/subway-stations.service");

  // No constructor dependencies: the registry is read from the committed files at import.
  const miniapps = new MiniappsService();
  const busGroups = codeHeldSource("src/bus", toBusGroupIds(jongroRoutes));
  const subwayStations = codeHeldSource("src/subway", new SubwayStationsService().listStations().map((station) => station.id));

  return {
    sources: {
      miniapps: { owner: "src/miniapps", has: (id) => miniapps.isRegistered(id), ids: () => miniapps.list.map((entry) => entry.id) },
      busGroups,
      subwayStations,
      busServices: codeHeldSource("src/bus", Object.keys(SERVICE_CONFIG)),
    },
    datasets: {
      "home-layout": {
        owner: "src/ui/home",
        schema: homeLayoutFile,
        issuesOf: (layout) => toHomeLayoutIssues(layout, miniapps),
        referencesOf: (layout) => homeLayoutReferences(layout, miniapps),
      },
      "campus-banners": {
        owner: "src/ui/campus",
        schema: campusBannersFile,
        issuesOf: (banners) => toCampusBannerIssues(banners, miniapps),
        referencesOf: (banners) => campusBannerReferences(banners, miniapps),
      },
      // A push is checked against this checkout's groups and stations, so it must place each exactly once.
      "transit-layout": {
        owner: "src/ui/transit",
        schema: transitLayoutFile,
        issuesOf: (layout) => toTransitLayoutIssues(layout, { busGroupIds: busGroups.ids(), stationIds: subwayStations.ids(), registry: miniapps }),
        referencesOf: (layout) => transitLayoutReferences(layout, miniapps),
      },
      // Every layer set's checks run in its schema; an activation in the eventmap database names a set by its id.
      "map-layer-sets": {
        owner: "src/map/layer-set",
        schema: layerSetsDataset,
        referencesOf: () => [],
        idsOf: ({ layerSets }) => layerSets.map((set) => set.layerSetId),
      },
      // Each stored key is a service this checkout's SERVICE_CONFIG defines; ids and behavior stay in code.
      "bus-service-notices": {
        owner: "src/bus/schedule-content",
        schema: busServiceNoticesDataset,
        referencesOf: serviceNoticesReferences,
      },
      // MM-DD recurs yearly, YYYY-MM-DD applies once; every key must be on the calendar.
      "skku-rest-days": {
        owner: "src/bus/schedule-content",
        schema: skkuRestDaysDataset,
        referencesOf: () => [],
      },
    },
  };
}

module.exports = { loadCatalog };
