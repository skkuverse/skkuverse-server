/**
 * The datasets `npm run data` knows, and the server code that validates each
 * one (ADR 0013, D5).
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
 *                    checks a schema cannot hold, as { path, message }, and
 *                    `warning: true` on one that is reported and refuses
 *                    nothing; `storedOf(name)` is another dataset's parsed
 *                    content in the target database, or null
 *                    (scripts/lib/datasets/checks.js)
 *   referencesOf(data)
 *                    every identity the data names, as { dataset, id, path };
 *                    `dataset` is another catalog dataset or a code-held source
 *   idsOf(data)      the identities others may reference (`miniapps` its ids,
 *                    which the three ui datasets name; `games` its ids, which
 *                    home-layout's game tiles name; `map-layer-sets` its
 *                    layer sets, which nothing references yet)
 *   reads            optional: the parted datasets whose parts its check
 *                    reads through `storedOf`. The tool fetches a parted
 *                    dataset's parts only for a check that names it here.
 *   collections      optional: the keys of the catalog's `collections` its
 *                    check reads through `issuesOf`'s `collectionOf(key)`,
 *                    read from the environment the run targets, or null when
 *                    not read
 *   recheckTriggers  optional: the other datasets whose content its
 *                    `issuesOf` depends on beyond their `idsOf`. When one of
 *                    them is pushed or checked, this dataset's `issuesOf` runs
 *                    again over its own stored data, `storedOf(<that one>)`
 *                    being the content checked, with its own `reads` and
 *                    `collections` read too; its refusing issues refuse that
 *                    push, reported as this dataset's (checks.js, step 5). A
 *                    dataset that needs an alias of `bus-stops` to stay, as a
 *                    journey dataset naming an unlisted route's pole does
 *                    (ADR 0022, D4), declares `recheckTriggers: ["bus-stops"]`
 *                    and refuses, in its `issuesOf`, a pole the stored
 *                    `bus-stops` no longer aliases
 *
 * `issuesOf`, `referencesOf` and `idsOf` take the schema's parsed output.
 *
 * A parted dataset (scripts/lib/datasets/parts.js) declares `parts` in place
 * of `schema`:
 *
 *   parts.schema     the zod schema the server parses each part with
 *   parts.keyOf      the part's key, from its own fields
 *   parts.summaryOf  what `history` and the push report show of a part
 *   parts.changesOf(stored, pushed)
 *                    optional: lines the push report adds to a changed part,
 *                    both parsed with parts.schema
 * and its `issuesOf` and `referencesOf` take the parsed parts, ordered by key.
 *
 * A collection is one outside the content database that a check reads, never
 * writes:
 *
 *   database         the .env name of its database's base name; the tool
 *                    adds `_dev` without --prod, as the server does
 *   name, projection what it reads
 *   keyOf(doc)       a document's identity
 *   fromFile(raw)    optional: the documents its own writer would store from
 *                    the file `push --against <file>` names, which replace the
 *                    stored ones of the same key for that push's check
 *   applyCommand(file, prod, { create })
 *                    optional: the command that writes that file, printed
 *                    after the push; `create` when the file holds a key the
 *                    target does not store
 *   splitExpired(docs, now)
 *                    optional: `{ served, expired }`, the documents the server
 *                    serves from today on and the rest, each with a
 *                    `message`; the check reads only the served ones, and the
 *                    tool prints each other one as skipped
 *
 * `busSchedules` is the stored shuttle timetables, which `npm run schedule`
 * writes; `bus-stops` reads it so a sequence and its timetable entries agree
 * (`stopTimesMismatches`, run by both writers). `jongroRoutes` and
 * `jongroRoutePaths` are the TOPIS registry and route lines the poller
 * stores; `bus-stops` builds the stop index from them, as the server does, to
 * resolve each stop area member and place it (ADR 0022, D4). `journey-routes`
 * resolves its cited stops through the same stop index, and its buildings
 * through `buildings`, the SKKU buildings skkuverse-crawler stores; it
 * declares `recheckTriggers: ["bus-stops"]`.
 *
 * A code-held source is an identity list that still lives in code, resolved
 * against the compiled checkout (ADR 0013, D5):
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
 * served platform, read from the target's stored `subway-timetables` (it
 * `reads` them), and refused when that database stores none this checkout can
 * read. `subway-timetables` is checked the other way, its pushed routes
 * against the target's stored `subway-topology`, and its tracked stops against
 * the run properties, both as warnings: a coverage change pushes its tables
 * first and its topology after, and the topology push is the gate that refuses.
 * A stop time at a served platform outside the service window
 * (`SERVICE_WINDOW_*` in src/subway/timetable) refuses the push: the window
 * widens in code first.
 */

const { buildDocuments, parseTimetableFile, splitExpired, stopTimesMismatches } = require("../campus-schedule-file");

const SHOWN_TRAIN_NUMBERS = 8;
const SHOWN_STOP_TIME_MISMATCHES = 3;

/** `word` as one shell word: as it is when plain, else single-quoted. */
const shellWord = (word) => (/^[\w./@:+-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`);

/** One issue per sequence whose timetable entries do not fit it, naming the first few; a warning when they were not read. */
function timetableIssues({ sequences }, docs) {
  if (docs === null) return [{ path: [], message: "bus_schedules was not read, so the sequences were not checked against the timetables", warning: true }];
  const bySequence = new Map();
  for (const mismatch of stopTimesMismatches(docs, sequences)) {
    const key = `${mismatch.serviceId}\u0000${mismatch.routeType}`;
    bySequence.set(key, [...(bySequence.get(key) ?? []), mismatch]);
  }
  return [...bySequence.values()].map((mismatches) => {
    const { serviceId, routeType } = mismatches[0];
    const count = mismatches.length === 1 ? "1 timetable entry does not" : `${mismatches.length} timetable entries do not`;
    const shown = mismatches.slice(0, SHOWN_STOP_TIME_MISMATCHES).map((mismatch) => mismatch.message);
    const more = mismatches.length > SHOWN_STOP_TIME_MISMATCHES ? [`and ${mismatches.length - SHOWN_STOP_TIME_MISMATCHES} more`] : [];
    return { path: ["sequences", serviceId, routeType], message: `${count} fit this sequence: ${[...shown, ...more].join("; ")}` };
  });
}

/** A changed timetable's trains added and removed, a train counted by its whole row, so a moved train is both. */
function trainChanges(stored, pushed) {
  const rowsOf = (table) => table.trains.map((train) => ({ trainNo: train.trainNo, row: JSON.stringify(train) }));
  const [before, after] = [rowsOf(stored), rowsOf(pushed)];
  const missingFrom = (rows) => (each) => !rows.some((other) => other.row === each.row);
  const [added, removed] = [after.filter(missingFrom(before)), before.filter(missingFrom(after))];
  if (added.length === 0 && removed.length === 0) return ["trains unchanged"];
  const numbers = (rows) => rows.slice(0, SHOWN_TRAIN_NUMBERS).map((each) => each.trainNo).join(", ") + (rows.length > SHOWN_TRAIN_NUMBERS ? ", ..." : "");
  const named = [added.length > 0 && `added ${numbers(added)}`, removed.length > 0 && `removed ${numbers(removed)}`].filter(Boolean);
  return [`trains +${added.length} -${removed.length} (${named.join("; ")})`];
}

function codeHeldSource(owner, ids) {
  const known = new Set(ids);
  return { owner, has: (id) => known.has(id), ids: () => [...ids] };
}

/**
 * The registry the ui checks read: the target database's stored `miniapps` as the server snapshots it, or,
 * with none stored, the grammar alone. Then every well-formed id and target passes here, and the outgoing
 * reference check names each one as `(no stored dataset)` at its path (ADR 0013, D5).
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
  const { busServiceNoticesDataset } = load("bus/schedule-content/bus-schedule-content.schema");
  const { serviceNoticesReferences } = load("bus/schedule-content/bus-schedule-content.rules");
  const { laneCorridorDataset } = load("bus/eta/lane/bus-eta-lane.schema");
  const { corridorIssues } = load("bus/eta/lane/bus-eta-lane.rules");
  const { jongroRouteAttributesDataset } = load("bus/route-attributes/bus-route-attributes.schema");
  const { hsscRouteLineDataset } = load("bus/hssc-route-line/bus-hssc-route-line.schema");
  const { toRouteLineIssues } = load("bus/hssc-route-line/bus-hssc-route-line.rules");
  const { skkuRestDaysDataset } = load("calendar/calendar.schema");
  const { toRouteAttributesIssues } = load("bus/route-attributes/bus-route-attributes.rules");
  const { busStopsDataset } = load("bus/stops/bus-stops.schema");
  const { busStopsReferences, etaOptIns, toBusStopsIssues } = load("bus/stops/bus-stops.rules");
  const { toBusStopsSnapshot } = load("bus/stops/bus-stops.mapper");
  const { toRegistryRoute } = load("bus/registry/bus-registry.mapper");
  const { toCanonicalStopId, toPoleArsId, toStopIndex } = load("bus/stop-index/bus-stop-index.rules");
  const { toPoleCoords } = load("bus/stop-index/bus-stop-index.mapper");
  const { LANE_STRATEGIES } = load("bus/eta/lane/bus-eta-lane.constants");
  const { checkedRegistry } = load("miniapps/miniapps.schema");
  const { isSingleEmoji, parseMiniAppTarget, toRegistryIssues } = load("miniapps/miniapps.rules");
  const { toMiniAppRegistry } = load("miniapps/miniapps.mapper");
  const { gamesFile } = load("games/games.schema");
  const { appPlatformGatesDataset } = load("app-config/app-config.schema");
  const { gameIdsOf, toGameOriginIssues, toTakenIdIssues } = load("games/games.rules");
  const { GAME_ID_BY_FIRST_PARTY_ORIGIN, MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, WEBVIEW_ORIGIN, WEB_ORIGIN } = load("infra/origins");
  const { JONGRO_ROUTES, SERVICE_CONFIG, SLUG_LETTER_PATTERN, TOPIS_ROUTES } = load("bus/bus.constants");
  const { toBusGroupIds } = load("bus/config/bus-config.mapper");
  const { SubwayStationsService } = load("subway/stations/subway-stations.service");
  const { SUBWAY_NETWORK, SUBWAY_STATIONS } = load("subway/subway.constants");
  const { toNetworkIssues } = load("subway/subway.rules");
  const { subwayTopologyDataset } = load("subway/topology/subway-topology.schema");
  const { subwayStationCoordsDataset } = load("subway/station-coords/subway-station-coords.schema");
  const { toStationCoordsIssues } = load("subway/station-coords/subway-station-coords.rules");
  const { toRouteIssues, toTopologyIssues } = load("subway/topology/subway-topology.rules");
  const { TIMETABLE_DAY_TYPES } = load("subway/timetable/subway-timetable.constants");
  const { findTimetable, toLineRoutes, toServiceWindowIssues, toTimetableCoverageIssues, toTimetableKey, toTrackedStopIssues } = load("subway/timetable/subway-timetable.rules");
  const { timetableFile } = load("subway/timetable/subway-timetable.schema");
  const { toRideTimetableIssue } = load("subway/timetable/departures/subway-timetable-departures.rules");
  const { journeyRoutesDataset } = load("journey/journey.schema");
  const { journeyRoutesReferences, toJourneyRoutesIssues } = load("journey/journey.rules");
  const { toPlaceIssues } = load("journey/places/journey-places.rules");

  const grammar = { parseTarget: parseMiniAppTarget };
  const registryParts = { toMiniAppRegistry, parseMiniAppTarget, isSingleEmoji, webOrigin: WEB_ORIGIN };
  const busGroups = codeHeldSource("src/bus", toBusGroupIds(JONGRO_ROUTES));
  const jongroRoutes = codeHeldSource("src/bus", JONGRO_ROUTES.map((route) => route.id));
  const servedStations = new SubwayStationsService().listStations();
  const subwayStations = codeHeldSource("src/subway", servedStations.map((station) => station.id));
  const campuslessStationIds = servedStations.filter((station) => station.campus === null).map((station) => station.id);
  const servedPlatforms = SUBWAY_STATIONS.flatMap((station) => station.platforms);
  const subwayPlatforms = codeHeldSource("src/subway", servedPlatforms.map((platform) => platform.id));
  // A topology is checked against this checkout's network, which must hold together first; its issues name the constants.
  const networkIssues = toNetworkIssues(SUBWAY_NETWORK).map((issue) => ({ path: ["SUBWAY_NETWORK", ...issue.path], message: `src/subway/subway.constants.ts: ${issue.message}` }));
  // Each served platform's routes in `tables`, one per distinct table of a day type its source declares.
  const routesOf = (tables) =>
    Object.fromEntries(
      servedPlatforms.map((platform) => {
        const found = TIMETABLE_DAY_TYPES[platform.timetable.source].map((dayType) => findTimetable(tables, platform, dayType)).filter(Boolean);
        return [platform.id, [...new Map(found.map((table) => [JSON.stringify(toLineRoutes(table)), toLineRoutes(table)])).values()]];
      }),
    );
  const noStoredTimetables = {
    path: ["subway-timetables"],
    message: "no stored subway-timetables this checkout can read, so the routes were not checked: push subway-timetables first",
  };
  // A topology is checked against the target's stored routes once its stops resolve: an unresolved stop would repeat there as an order issue.
  const topologyIssues = (topology, { storedOf }) => {
    const issues = [...networkIssues, ...toTopologyIssues(topology, SUBWAY_NETWORK)];
    if (issues.length > 0) return issues;
    const tables = storedOf("subway-timetables");
    return tables === null ? [noStoredTimetables] : toRouteIssues(topology, routesOf(tables));
  };
  // Mini apps and games share one id namespace, so each registry's push is checked against the other's stored ids.
  const miniAppIdsAt = ({ index }) => index.miniApps.map((entry, position) => ({ id: entry.id, path: ["index", "miniApps", position, "id"] }));
  const storedMiniAppIds = (registry) => (registry === null ? [] : registry.index.miniApps.map((entry) => entry.id));
  const storedGameIds = (games) => (games === null ? [] : games.games.map((game) => game.id));
  const asWarnings = (issues, at = []) => issues.map((issue) => ({ path: [...at, ...issue.path], message: issue.message, warning: true }));
  // The pushed routes against the stored topology, whose own push refuses a disagreement: warning here lets either go first.
  const timetableRouteWarnings = (tables, topology) =>
    topology === null
      ? asWarnings([{ path: [], message: "no stored subway-topology, so the tables' routes were not checked against it" }], ["subway-topology"])
      : asWarnings(toRouteIssues(topology, routesOf(tables)), ["subway-topology"]);

  // The stop index a bus-stops push resolves its stop areas' members through, built as the server builds it from the
  // target's stored registry and route lines: a catalog stop is itself, a pole (by station id or `seoul-` alias) the
  // stop a listed route serves it as.
  const stopAreaResolutionOf = (data, registryDocs, routePathDocs) => {
    const routes = TOPIS_ROUTES.flatMap((route) => registryDocs.filter((doc) => doc._id === route.id).map((doc) => toRegistryRoute(route, doc)));
    const index = toStopIndex(toBusStopsSnapshot({ revision: 0, data: JSON.parse(JSON.stringify(data)) }), routes);
    const catalogStops = new Map(data.stops.map((stop) => [stop.id, stop]));
    const stopIdOf = (memberId) => {
      const stopId = toCanonicalStopId(index, memberId);
      return stopId !== undefined && (catalogStops.has(stopId) || index.stopById.has(stopId)) ? stopId : null;
    };
    const coordsOf = (stopId) => catalogStops.get(stopId)?.coords ?? toPoleCoords(index.stopById.get(stopId)?.poles ?? [], routePathDocs);
    return { stopIdOf, coordsOf };
  };
  const stopAreasUnread = {
    path: ["stopAreas"],
    message: "jongro_routes or jongro_route_paths was not read, so the stop areas' members were not checked",
    warning: true,
  };
  const busStopsIssues = (data, { collectionOf }) => {
    const [registryDocs, routePathDocs] = [collectionOf("jongroRoutes"), collectionOf("jongroRoutePaths")];
    const isUnread = registryDocs === null || routePathDocs === null;
    const stopAreaResolution = isUnread ? undefined : stopAreaResolutionOf(data, registryDocs, routePathDocs);
    const context = { knownServiceIds: new Set(Object.keys(SERVICE_CONFIG)), optIns: etaOptIns(SERVICE_CONFIG), stationIds: new Set(subwayStations.ids()), laneStrategies: LANE_STRATEGIES };
    const unread = isUnread && (data.stopAreas ?? []).length > 0 ? [stopAreasUnread] : [];
    return [...toBusStopsIssues(data, { ...context, stopAreaResolution }), ...timetableIssues(data, collectionOf("busSchedules")), ...unread];
  };

  // What a journey dataset's places resolve against: a stop or pole through the stop index built from the target's
  // stored bus-stops, registry and route lines (only the catalog's own stops when those are not read), the target's
  // station coords and buildings, and this checkout's served stations and platforms; a subway ride's order against the
  // target's stored timetables, joined as the subway door joins them.
  const journeyCatalogOf = (storedOf, collectionOf) => {
    const busStops = storedOf("bus-stops");
    const [registryDocs, routePathDocs, buildings] = [collectionOf("jongroRoutes"), collectionOf("jongroRoutePaths"), collectionOf("buildings")];
    const resolution = busStops && registryDocs && routePathDocs ? stopAreaResolutionOf(busStops, registryDocs, routePathDocs) : null;
    const localCoords = new Map((busStops?.stops ?? []).map((stop) => [stop.id, stop.coords ?? null]));
    const stopCoordsOf = (id) => {
      if (resolution === null) return localCoords.has(id) ? localCoords.get(id) : undefined;
      const stopId = resolution.stopIdOf(id);
      return stopId === null ? undefined : resolution.coordsOf(stopId);
    };
    const stationCoords = storedOf("subway-station-coords");
    const timetables = storedOf("subway-timetables");
    const toLatLng = (location) => (Array.isArray(location?.coordinates) ? { lat: location.coordinates[1], lng: location.coordinates[0] } : null);
    return {
      stopCoordsOf: busStops && stopCoordsOf,
      sequencesByService: busStops && busStops.sequences,
      buildingCoords: buildings && new Map(buildings.map((doc) => [String(doc._id), toLatLng(doc.location)])),
      stationCoords: new Map(subwayStations.ids().map((id) => [id, stationCoords?.stations[id] ?? null])),
      platformIdsByStation: new Map(SUBWAY_STATIONS.map((station) => [station.id, new Set(station.platforms.map((platform) => platform.id))])),
      subwayRideIssueOf: timetables && ((ride) => toRideTimetableIssue(timetables, ride)),
    };
  };

  return {
    collections: {
      // The SKKU buildings skkuverse-crawler writes; a journey dataset's skku_building places resolve to their points.
      buildings: {
        database: "MONGO_BUILDING_DB_NAME",
        name: "buildings",
        projection: { _id: 1, location: 1 },
        keyOf: (doc) => String(doc._id),
      },
      busSchedules: {
        database: "MONGO_DB_NAME_BUS_CAMPUS",
        name: "bus_schedules",
        projection: { _id: 0, serviceId: 1, patternId: 1, effectiveUntil: 1, "entries.time": 1, "entries.routeType": 1, "entries.stopTimes": 1 },
        keyOf: (doc) => `${doc.serviceId}/${doc.patternId}`,
        fromFile: (raw) => buildDocuments(parseTimetableFile(raw)),
        splitExpired,
        applyCommand: (file, prod, { create = false } = {}) =>
          `npm run schedule -- --file ${shellWord(file)}${create ? " --create" : ""}${prod ? " --prod" : ""}`,
      },
      // The TOPIS registry and route lines the poller stores, which the stop index is built from.
      jongroRoutes: {
        database: "MONGO_DB_NAME_BUS_CAMPUS",
        name: "jongro_routes",
        projection: { stations: 1, turnaroundTopisId: 1, stationsVersion: 1 },
        keyOf: (doc) => doc._id,
      },
      jongroRoutePaths: {
        database: "MONGO_DB_NAME_BUS_CAMPUS",
        name: "jongro_route_paths",
        projection: { "stations.topisId": 1, "stations.lat": 1, "stations.lng": 1 },
        keyOf: (doc) => doc._id,
      },
    },
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
        issuesOf: (registry, { storedOf }) => [
          ...toRegistryIssues(registry, { owners: MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, webviewOrigin: WEBVIEW_ORIGIN }),
          ...toTakenIdIssues(miniAppIdsAt(registry), storedGameIds(storedOf("games")), "games"),
        ],
        referencesOf: () => [],
        idsOf: ({ index }) => index.miniApps.map((entry) => entry.id),
      },
      // Only what exposes each hosted game; who owns a game origin stays in src/infra/origins.ts (skkuverse-app add-game-factory D3).
      // Its ids are what home-layout's game tiles name, but for the games installed builds ship bundled.
      games: {
        owner: "src/games",
        schema: gamesFile,
        issuesOf: (games, { storedOf }) => [
          ...toTakenIdIssues(gameIdsOf(games), storedMiniAppIds(storedOf("miniapps")), "miniapps"),
          ...toGameOriginIssues(games, GAME_ID_BY_FIRST_PARTY_ORIGIN),
        ],
        referencesOf: () => [],
        idsOf: ({ games }) => games.map((game) => game.id),
      },
      // The force-update floor on /app/config; a replica that never read it answers 503, never a permissive gate.
      "app-platform-gates": {
        owner: "src/app-config",
        schema: appPlatformGatesDataset,
        referencesOf: () => [],
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
          toTransitLayoutIssues(layout, { busGroupIds: busGroups.ids(), stationIds: subwayStations.ids(), campuslessStationIds, registry: registryOf(storedOf, registryParts) }),
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
        owner: "src/calendar",
        schema: skkuRestDaysDataset,
        referencesOf: () => [],
      },
      // The corridor geometry only: which runs use it, and the lane hours, stay in code (ADR 0013, D2).
      "bus-lane-corridor": {
        owner: "src/bus/eta/lane",
        schema: laneCorridorDataset,
        issuesOf: corridorIssues,
        referencesOf: () => [],
      },
      // Each Jongro route's card, refresh interval, seat count and transfer lines; its id stays in code (ADR 0013, D2).
      "jongro-route-attributes": {
        owner: "src/bus/route-attributes",
        schema: jongroRouteAttributesDataset,
        issuesOf: (attributes) => toRouteAttributesIssues(attributes, jongroRoutes.ids()),
        referencesOf: () => [],
      },
      // The HSSC loop as measured from GPS, which the map draws; it has no upstream, so it is data, not a sync (ADR 0018, D9).
      "hssc-route-line": {
        owner: "src/bus/hssc-route-line",
        schema: hsscRouteLineDataset,
        issuesOf: toRouteLineIssues,
        referencesOf: () => [],
      },
      // The local stops, the shuttle sequences, the HSSC line and the stop areas; the service ids, estimate opt-ins, travel
      // strategies and HSSC position count stay in code (ADR 0013, D2). Its stop and stop area ids are what later datasets
      // may name. Its sequences are checked against the target's stored timetables, whose stop times follow them, and its
      // stop areas' members against the stop index built from the target's stored registry and route lines (ADR 0022, D4).
      "bus-stops": {
        owner: "src/bus/stops",
        schema: busStopsDataset,
        collections: ["busSchedules", "jongroRoutes", "jongroRoutePaths"],
        issuesOf: busStopsIssues,
        referencesOf: busStopsReferences,
        idsOf: ({ stops, stopAreas = [] }) => [...stops.map((stop) => stop.id), ...stopAreas.map((area) => area.id)],
      },
      // Each served platform's directions and the neighbor stops; the lines, stations and platforms stay in code (ADR 0013, D2).
      "subway-topology": {
        owner: "src/subway/topology",
        schema: subwayTopologyDataset,
        reads: ["subway-timetables"],
        issuesOf: topologyIssues,
        referencesOf: () => [],
      },
      // Each served station's camera point, inside South Korea; the stations stay in code (ADR 0013, D2).
      "subway-station-coords": {
        owner: "src/subway/station-coords",
        schema: subwayStationCoordsDataset,
        issuesOf: (coords) => toStationCoordsIssues(coords, subwayStations.ids()),
        referencesOf: () => [],
      },
      // One table per operator line and day type, a part each; every served platform needs one per day type its source declares (docs/how-to/update-subway-timetables.md).
      "subway-timetables": {
        owner: "src/subway/timetable",
        parts: {
          schema: timetableFile,
          keyOf: toTimetableKey,
          summaryOf: (table) => ({ source: table.source, trainCount: table.trains.length }),
          changesOf: trainChanges,
        },
        issuesOf: (tables, { storedOf }) => [
          ...toTimetableCoverageIssues(tables, servedPlatforms),
          ...toServiceWindowIssues(tables, servedPlatforms),
          ...timetableRouteWarnings(tables, storedOf("subway-topology")),
          ...asWarnings(toTrackedStopIssues(tables, servedPlatforms)),
        ],
        referencesOf: () => [],
      },
      // Lines, routes, options and legs; each place is cited as <kind>:<id> and resolves through its owning catalog in the
      // target environment, and the sources' own identities stay in code (ADR 0022, D4; ADR 0013, D2). Its cited stops are
      // bus-stops references, and a bus-stops push reruns its checks, so neither a dropped stop nor a dropped alias or a
      // reordered sequence it rides on passes.
      "journey-routes": {
        owner: "src/journey",
        schema: journeyRoutesDataset,
        reads: ["subway-timetables"],
        collections: ["buildings", "jongroRoutes", "jongroRoutePaths"],
        recheckTriggers: ["bus-stops"],
        issuesOf: (data, { storedOf, collectionOf }) => {
          const journeyCatalog = journeyCatalogOf(storedOf, collectionOf);
          return [...toJourneyRoutesIssues(data, journeyCatalog), ...toPlaceIssues(data, journeyCatalog)];
        },
        // A TOPIS pole (its station id, which holds no letter, or its `seoul-` alias) is no bus-stops id: it resolves
        // through the stop index in issuesOf, rechecked on every bus-stops push.
        referencesOf: (data) => journeyRoutesReferences(data).filter((ref) => toPoleArsId(ref.id) === null && SLUG_LETTER_PATTERN.test(ref.id)),
      },
    },
  };
}

module.exports = { loadCatalog };
