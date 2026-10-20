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
 *   issuesOf(data, { storedOf })
 *                    checks a schema cannot hold, as { path, message };
 *                    `storedOf(name)` is another dataset's parsed content in
 *                    the target database, or null (scripts/lib/datasets/checks.js)
 *   referencesOf(data)
 *                    every identity the data names, as { dataset, id, path };
 *                    `dataset` is another catalog dataset or a code-held source
 *   idsOf(data)      the identities others may reference (`miniapps` its ids,
 *                    which the three ui datasets name; `map-layer-sets` its
 *                    layer sets, which nothing references yet)
 *
 * `issuesOf`, `referencesOf` and `idsOf` take the schema's parsed output.
 *
 * A parted dataset (scripts/lib/datasets/parts.js) declares `parts` in place
 * of `schema`:
 *
 *   parts.schema     the zod schema the server parses each part with
 *   parts.keyOf      the part's key, from its own fields
 *   parts.summaryOf  what `history` and the push report show of a part
 *
 * and its `issuesOf` and `referencesOf` take the parsed parts, ordered by key.
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
 * BusConfigService.listGroupIds's `toBusGroupIds(JONGRO_ROUTES)`,
 * `subwayStations` SubwayStationsService.listStations's ids, `busServices`
 * the keys of SERVICE_CONFIG, `jongroRoutes` the ids of JONGRO_ROUTES,
 * `subwayPlatforms` the platform ids of SUBWAY_STATIONS.
 *
 * `subway-topology` is also checked against the timetable routes of every
 * served platform, read from the checkout's committed SUBWAY_TIMETABLES.
 */

function codeHeldSource(owner, ids) {
  const known = new Set(ids);
  return { owner, has: (id) => known.has(id), ids: () => [...ids] };
}

/**
 * The registry the ui checks read: the target database's stored `miniapps` as the server snapshots it, or,
 * with none stored, the grammar alone. Then every well-formed id and target passes here, and the outgoing
 * reference check names each one as `(no stored dataset)` at its path (move-miniapp-registry D6).
 */
function registryOf(storedOf, { toMiniAppRegistry, parseMiniAppTarget, isSingleEmoji, webOrigin }) {
  const stored = storedOf("miniapps");
  if (stored !== null) return toMiniAppRegistry(stored, 0, webOrigin);
  return {
    isRegistered: () => true,
    isKnownMiniAppTarget: (value) => parseMiniAppTarget(value) !== null,
    parseTarget: parseMiniAppTarget,
    isSingleEmoji,
  };
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
  const { laneCorridorDataset } = load("bus/eta/lane/bus-eta-lane.schema");
  const { corridorIssues } = load("bus/eta/lane/bus-eta-lane.rules");
  const { jongroRouteAttributesDataset } = load("bus/route-attributes/bus-route-attributes.schema");
  const { toRouteAttributesIssues } = load("bus/route-attributes/bus-route-attributes.rules");
  const { checkedRegistry } = load("miniapps/miniapps.schema");
  const { isSingleEmoji, parseMiniAppTarget, toRegistryIssues } = load("miniapps/miniapps.rules");
  const { toMiniAppRegistry } = load("miniapps/miniapps.mapper");
  const { MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, WEBVIEW_ORIGIN, WEB_ORIGIN } = load("infra/origins");
  const { JONGRO_ROUTES, SERVICE_CONFIG } = load("bus/bus.constants");
  const { toBusGroupIds } = load("bus/config/bus-config.mapper");
  const { SubwayStationsService } = load("subway/stations/subway-stations.service");
  const { SUBWAY_NETWORK, SUBWAY_STATIONS } = load("subway/subway.constants");
  const { toNetworkIssues } = load("subway/subway.rules");
  const { subwayTopologyDataset } = load("subway/topology/subway-topology.schema");
  const { toRouteIssues, toTopologyIssues } = load("subway/topology/subway-topology.rules");
  const { SUBWAY_TIMETABLES } = load("subway/timetable/subway-timetable.config");
  const { TIMETABLE_DAY_TYPES } = load("subway/timetable/subway-timetable.constants");
  const { findTimetable, toLineRoutes, toTimetableCoverageIssues, toTimetableKey } = load("subway/timetable/subway-timetable.rules");
  const { timetableFile } = load("subway/timetable/subway-timetable.schema");

  const grammar = { parseTarget: parseMiniAppTarget };
  const registryParts = { toMiniAppRegistry, parseMiniAppTarget, isSingleEmoji, webOrigin: WEB_ORIGIN };
  const busGroups = codeHeldSource("src/bus", toBusGroupIds(JONGRO_ROUTES));
  const jongroRoutes = codeHeldSource("src/bus", JONGRO_ROUTES.map((route) => route.id));
  const subwayStations = codeHeldSource("src/subway", new SubwayStationsService().listStations().map((station) => station.id));
  const servedPlatforms = SUBWAY_STATIONS.flatMap((station) => station.platforms);
  const subwayPlatforms = codeHeldSource("src/subway", servedPlatforms.map((platform) => platform.id));
  // A topology is checked against this checkout's network, which must hold together first; its issues name the constants.
  const networkIssues = toNetworkIssues(SUBWAY_NETWORK).map((issue) => ({ path: ["SUBWAY_NETWORK", ...issue.path], message: `src/subway/subway.constants.ts: ${issue.message}` }));
  // WHY: the committed timetables are this checkout's until wave D (move-reference-datasets D5) stores them; then
  // these routes come from the target database's `subway-timetables` through `storedOf`. One route per distinct table.
  const routesByPlatformId = Object.fromEntries(
    SUBWAY_STATIONS.flatMap((station) => station.platforms).map((platform) => {
      const tables = TIMETABLE_DAY_TYPES[platform.timetable.source].map((dayType) => findTimetable(SUBWAY_TIMETABLES, platform, dayType)).filter(Boolean);
      const routes = [...new Map(tables.map((table) => [JSON.stringify(toLineRoutes(table)), toLineRoutes(table)])).values()];
      return [platform.id, routes];
    }),
  );
  // A topology is checked against the routes once its stops resolve: an unresolved stop would repeat there as an order issue.
  const topologyIssues = (topology) => {
    const issues = [...networkIssues, ...toTopologyIssues(topology, SUBWAY_NETWORK)];
    return issues.length > 0 ? issues : toRouteIssues(topology, routesByPlatformId);
  };

  return {
    sources: {
      busGroups,
      subwayStations,
      busServices: codeHeldSource("src/bus", Object.keys(SERVICE_CONFIG)),
      jongroRoutes,
      subwayPlatforms,
    },
    datasets: {
      // Its ids are what the ui datasets name; who owns a first-party origin stays in src/infra/origins.ts.
      miniapps: {
        owner: "src/miniapps",
        schema: checkedRegistry,
        issuesOf: (registry) => toRegistryIssues(registry, { owners: MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, webviewOrigin: WEBVIEW_ORIGIN }),
        referencesOf: () => [],
        idsOf: ({ index }) => index.miniApps.map((entry) => entry.id),
      },
      "home-layout": {
        owner: "src/ui/home",
        schema: homeLayoutFile,
        issuesOf: (layout, { storedOf }) => toHomeLayoutIssues(layout, registryOf(storedOf, registryParts)),
        referencesOf: (layout) => homeLayoutReferences(layout, grammar),
      },
      "campus-banners": {
        owner: "src/ui/campus",
        schema: campusBannersFile,
        issuesOf: (banners, { storedOf }) => toCampusBannerIssues(banners, registryOf(storedOf, registryParts)),
        referencesOf: (banners) => campusBannerReferences(banners, grammar),
      },
      // A push is checked against this checkout's groups and stations, so it must place each exactly once.
      "transit-layout": {
        owner: "src/ui/transit",
        schema: transitLayoutFile,
        issuesOf: (layout, { storedOf }) =>
          toTransitLayoutIssues(layout, { busGroupIds: busGroups.ids(), stationIds: subwayStations.ids(), registry: registryOf(storedOf, registryParts) }),
        referencesOf: (layout) => transitLayoutReferences(layout, grammar),
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
      // The corridor geometry only: which runs use it, and the lane hours, stay in code (move-reference-datasets D9).
      "bus-lane-corridor": {
        owner: "src/bus/eta/lane",
        schema: laneCorridorDataset,
        issuesOf: corridorIssues,
        referencesOf: () => [],
      },
      // Each Jongro route's card, refresh interval, seat count and transfer lines; its id stays in code (move-reference-datasets D10).
      "jongro-route-attributes": {
        owner: "src/bus/route-attributes",
        schema: jongroRouteAttributesDataset,
        issuesOf: (attributes) => toRouteAttributesIssues(attributes, jongroRoutes.ids()),
        referencesOf: () => [],
      },
      // Each served platform's directions and the neighbor stops; the lines, stations and platforms stay in code (move-reference-datasets D2, D3).
      "subway-topology": {
        owner: "src/subway/topology",
        schema: subwayTopologyDataset,
        issuesOf: topologyIssues,
        referencesOf: () => [],
      },
      // One table per operator line and day type, a part each; every served platform needs one per day type its source declares (move-reference-datasets D5, D6).
      "subway-timetables": {
        owner: "src/subway/timetable",
        parts: {
          schema: timetableFile,
          keyOf: toTimetableKey,
          summaryOf: (table) => ({ source: table.source, trainCount: table.trains.length }),
        },
        issuesOf: (tables) => toTimetableCoverageIssues(tables, servedPlatforms),
        referencesOf: () => [],
      },
    },
  };
}

module.exports = { loadCatalog };
