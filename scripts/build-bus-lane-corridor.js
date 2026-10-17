#!/usr/bin/env node
/**
 * Build the 경부고속도로 bus-lane corridor of src/bus/eta/lane/bus-lane.json:
 * the centerline with its named boundaries, and each probe route's `sectOrd`
 * ranges. The other keys of that file (lane hours, strategies, entry and exit
 * points) are kept as they are; a missing file gets placeholders.
 *
 * Sources:
 *   - centerline: OpenStreetMap (ODbL), the ways named 경부고속도로 between
 *     한남IC and 신갈JC (`highway=trunk` north of 양재, `motorway` south of it),
 *     averaged between the two carriageways and resampled every ~200 m;
 *   - boundaries: OSM junction and toll nodes projected onto the centerline;
 *   - ranges: TOPIS `getArrInfoByRouteAll`, one call per probe route. A bus in
 *     section N is between station N and N+1, so a direction's range runs from
 *     the section that reaches its first corridor station to the one that
 *     leaves its last; the 60 m on-corridor test cuts the parts off 경부.
 *
 * Usage (keys come from the environment, never from argv):
 *   doppler run -p backend -c dev_server -- node scripts/build-bus-lane-corridor.js [options]
 *
 *   --osm <file>          read the Overpass response from a file instead of fetching it
 *   --save-osm <file>     write the fetched Overpass response there
 *   --topis-dir <dir>     read arrive-<routeId>.json (getArrInfoByRouteAll) from <dir>
 *   --dry-run             print the summary, write nothing
 *   --check-probe <dir>   instead of building, project buspos-<routeId>.json
 *                         (getBusPosByRtid) from <dir>, or fetch one snapshot per
 *                         route when <dir> is "live", against the committed corridor
 *   --check-entry-exit    instead of building, route both directions through the
 *                         committed entry and exit points with NAVER Directions 5
 *                         (2 calls) and report legs and via-point distances
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LANE_FILE = path.join(ROOT, "src/bus/eta/lane/bus-lane.json");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const TOPIS_URL = "http://ws.bus.go.kr/api/rest";
const NAVER_URL = "https://maps.apigw.ntruss.com/map-direction/v1/driving";
const USER_AGENT = "skkuverse-server corridor script";

const BBOX = "37.26,126.99,37.545,127.13";
const OVERPASS_QUERY = `[out:json][timeout:120];(
way["highway"~"^(motorway|trunk)$"]["name"="경부고속도로"](${BBOX});
node["highway"="motorway_junction"](${BBOX});
node["barrier"="toll_booth"](${BBOX});
);out geom tags;`;

const RESAMPLE_M = 25;
const VERTEX_SPACING_M = 200;
const MAX_CARRIAGEWAY_GAP_M = 80;
const ON_CORRIDOR_M = 60;
const STATION_SIDE_TOLERANCE_M = 400;
const VIA_POINT_MAX_M = 150;

// The corridor ends at 신갈JC where the southbound exit to 영동고속도로 leaves 경부 (OSM node 436210017,
// exits 45A/45B); the 한남IC end is where the named 경부 carriageways begin, at the south end of 한남대교.
const SOUTH_END_NODE = 436210017;

// OSM node ids per boundary, averaged after projection. 한남IC and 신갈JC are the corridor ends.
const BOUNDARY_NODES = [
  ["반포IC", [2244637670, 11073569991]],
  ["서초IC", [732030777, 732030799, 732030981, 11091065444]],
  ["양재IC", [734789603, 734789643]],
  ["금토JC", [5695668393]],
  ["판교IC", [1668416439, 1668416604]],
  ["서울TG", [414691935, 558899164]],
  ["죽전", [558899141]],
];

const PROBE_ROUTES = [
  { routeId: "200000205", name: "8800" },
  { routeId: "228000174", name: "5000" },
  { routeId: "228000175", name: "5005" },
];

// TOPIS timing points (`stNm` without "(미정차)") that lie on the corridor.
const CORRIDOR_STATIONS = new Set([
  "한남IC", "반포IC", "서초IC", "양재IC", "청계산입구역", "서울진입", "성남진입",
  "금토JC", "판교IC", "서울TG", "금곡", "죽전", "신갈JC",
]);

const PLACEHOLDER_HOURS = { from: "07:00", to: "21:00" };

function parseArgs(argv) {
  const args = { osm: null, saveOsm: null, topisDir: null, dryRun: false, checkProbe: null, checkEntryExit: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--osm") args.osm = argv[++i];
    else if (arg === "--save-osm") args.saveOsm = argv[++i];
    else if (arg === "--topis-dir") args.topisDir = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--check-probe") args.checkProbe = argv[++i];
    else if (arg === "--check-entry-exit") args.checkEntryExit = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run under doppler run -p backend -c dev_server`);
  return value;
}


const LAT0 = 37.4;
const M_PER_DEG_LAT = 110_950;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

const toXY = (p) => ({ x: p.lng * M_PER_DEG_LNG, y: p.lat * M_PER_DEG_LAT });
const toLatLng = (q) => ({ lat: q.y / M_PER_DEG_LAT, lng: q.x / M_PER_DEG_LNG });

function haversineM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function cumulative(points) {
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + haversineM(points[i - 1], points[i]));
  return along;
}

/** The nearest point of a polyline to `p`: its distance in meters, its along-distance and the point itself. */
function project(points, along, p) {
  const q = toXY(p);
  let best = { distanceM: Infinity, alongM: 0, point: points[0] };
  for (let i = 1; i < points.length; i++) {
    const a = toXY(points[i - 1]);
    const b = toXY(points[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / lengthSq));
    const foot = { x: a.x + t * dx, y: a.y + t * dy };
    const distanceM = Math.hypot(q.x - foot.x, q.y - foot.y);
    if (distanceM < best.distanceM) {
      best = { distanceM, alongM: along[i - 1] + t * (along[i] - along[i - 1]), point: toLatLng(foot) };
    }
  }
  return best;
}

/** Points every `stepM` along a polyline, its last point included. */
function resample(points, stepM) {
  const along = cumulative(points);
  const total = along[along.length - 1];
  const out = [];
  let segment = 1;
  for (let target = 0; target < total; target += stepM) {
    while (along[segment] < target) segment++;
    const t = (target - along[segment - 1]) / (along[segment] - along[segment - 1] || 1);
    const a = points[segment - 1];
    const b = points[segment];
    out.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) });
  }
  out.push(points[points.length - 1]);
  return out;
}


const keyOf = (p) => `${p.lat},${p.lon}`;

/** One carriageway: from the way that starts furthest along `isFirst`, follow same-direction ways end to start. */
function chain(ways, isFirst) {
  const byStart = new Map();
  for (const way of ways) {
    const key = keyOf(way.geometry[0]);
    byStart.set(key, [...(byStart.get(key) ?? []), way]);
  }
  const lanesOf = (w) => Number(w.tags.lanes ?? 0);
  let current = [...ways].sort(isFirst)[0];
  const seen = new Set();
  const points = [];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const geometry = current.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
    points.push(...(points.length === 0 ? geometry : geometry.slice(1)));
    const next = byStart.get(keyOf(current.geometry[current.geometry.length - 1])) ?? [];
    current = [...next].sort((a, b) => lanesOf(b) - lanesOf(a) || b.geometry.length - a.geometry.length)[0];
  }
  return points;
}

function buildCenterline(osm) {
  const ways = osm.elements.filter((e) => e.type === "way" && e.tags.highway !== "trunk_link");
  if (ways.length === 0) throw new Error("Overpass returned no 경부고속도로 ways");
  const isSouthbound = (w) => w.geometry[0].lat > w.geometry[w.geometry.length - 1].lat;
  const southbound = chain(ways.filter(isSouthbound), (a, b) => b.geometry[0].lat - a.geometry[0].lat);
  const northbound = chain(ways.filter((w) => !isSouthbound(w)), (a, b) => a.geometry[0].lat - b.geometry[0].lat);
  const northboundAlong = cumulative(northbound);

  const dense = resample(southbound, RESAMPLE_M).flatMap((p) => {
    const nearest = project(northbound, northboundAlong, p);
    if (nearest.distanceM > MAX_CARRIAGEWAY_GAP_M) return [];
    return [{ lat: (p.lat + nearest.point.lat) / 2, lng: (p.lng + nearest.point.lng) / 2 }];
  });

  const southEnd = nodeById(osm, SOUTH_END_NODE);
  const denseAlong = cumulative(dense);
  const cut = project(dense, denseAlong, southEnd);
  const clipped = [...dense.filter((_, i) => denseAlong[i] < cut.alongM), cut.point];
  return {
    centerline: resample(clipped, VERTEX_SPACING_M).map(round),
    carriageways: { southbound: southbound.length, northbound: northbound.length, paired: dense.length },
  };
}

const round = (p) => ({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) });

function nodeById(osm, id) {
  const node = osm.elements.find((e) => e.type === "node" && e.id === id);
  if (!node) throw new Error(`OSM node ${id} is missing from the Overpass response`);
  return { lat: node.lat, lng: node.lon };
}

function buildBoundaries(osm, centerline) {
  const along = cumulative(centerline);
  const total = along[along.length - 1];
  const inner = BOUNDARY_NODES.map(([name, ids]) => {
    const projections = ids.map((id) => project(centerline, along, nodeById(osm, id)));
    const far = projections.find((p) => p.distanceM > ON_CORRIDOR_M * 2);
    if (far) throw new Error(`${name}: a node lies ${Math.round(far.distanceM)} m off the centerline`);
    return { name, alongM: Math.round(projections.reduce((sum, p) => sum + p.alongM, 0) / projections.length) };
  });
  return [{ name: "한남IC", alongM: 0 }, ...inner, { name: "신갈JC", alongM: Math.round(total) }];
}


async function topisJson(fn, routeId) {
  const key = requireEnv("SEOUL_BUS_SERVICE_KEY");
  // QUIRK(TOPIS): the stored key is already URL-encoded; encoding it again breaks it.
  const res = await fetch(`${TOPIS_URL}/${fn}?serviceKey=${key}&busRouteId=${routeId}&resultType=json`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`TOPIS ${fn} ${routeId}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.msgHeader?.headerCd !== "0") throw new Error(`TOPIS ${fn} ${routeId}: header ${body.msgHeader?.headerCd}`);
  return body;
}

async function readOrFetch(dir, prefix, fn, routeId) {
  if (dir) return JSON.parse(fs.readFileSync(path.join(dir, `${prefix}-${routeId}.json`), "utf8"));
  return topisJson(fn, routeId);
}

const stationName = (item) => item.stNm.replace(/\(미정차\)$/, "");

/** Each direction's section range: from the section that reaches its first corridor station to the one that leaves its last. */
function sectionRanges(items) {
  const runs = [];
  for (const item of items) {
    const ord = Number(item.staOrd);
    const name = stationName(item);
    if (!CORRIDOR_STATIONS.has(name)) continue;
    const last = runs[runs.length - 1];
    if (last && last.lastOrd === ord - 1) Object.assign(last, { lastOrd: ord, lastName: name });
    else runs.push({ firstOrd: ord, firstName: name, lastOrd: ord, lastName: name });
  }
  const southbound = runs.filter((r) => r.firstName === "한남IC");
  const northbound = runs.filter((r) => r.lastName === "한남IC");
  if (southbound.length !== 1 || northbound.length !== 1) {
    throw new Error(`expected one run per direction, got ${JSON.stringify(runs)}`);
  }
  const toRange = (r) => ({ from: r.firstOrd - 1, to: r.lastOrd });
  return { southbound: toRange(southbound[0]), northbound: toRange(northbound[0]), runs };
}

async function buildProbeRoutes(topisDir) {
  const out = [];
  for (const route of PROBE_ROUTES) {
    const body = await readOrFetch(topisDir, "arrive", "arrive/getArrInfoByRouteAll", route.routeId);
    const { southbound, northbound, runs } = sectionRanges(body.msgBody.itemList);
    process.stdout.write(`  ${route.name} ${route.routeId}: ${runs.map((r) => `${r.firstName}#${r.firstOrd}..${r.lastName}#${r.lastOrd}`).join(", ")}\n`);
    out.push({ ...route, sectOrds: { southbound, northbound } });
  }
  return out;
}


async function readOsm(args) {
  if (args.osm) return JSON.parse(fs.readFileSync(args.osm, "utf8"));
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
    signal: AbortSignal.timeout(150000),
  });
  if (!res.ok) throw new Error(`Overpass: HTTP ${res.status}`);
  const text = await res.text();
  if (args.saveOsm) fs.writeFileSync(args.saveOsm, text);
  return JSON.parse(text);
}

function readLaneFile() {
  return fs.existsSync(LANE_FILE) ? JSON.parse(fs.readFileSync(LANE_FILE, "utf8")) : null;
}

function placeholderEntryExit(centerline) {
  const north = centerline[0];
  const south = centerline[centerline.length - 1];
  return { southbound: { entry: north, exit: south }, northbound: { entry: south, exit: north } };
}

async function build(args) {
  const osm = await readOsm(args);
  const { centerline, carriageways } = buildCenterline(osm);
  const boundaries = buildBoundaries(osm, centerline);
  const probeRoutes = await buildProbeRoutes(args.topisDir);
  const existing = readLaneFile();
  const lane = {
    laneHours: existing?.laneHours ?? PLACEHOLDER_HOURS,
    strategies: existing?.strategies ?? {},
    corridor: { centerline, boundaries },
    entryExit: existing?.entryExit ?? placeholderEntryExit(centerline),
    probeRoutes,
  };
  const spacing = cumulative(centerline).slice(1).map((a, i, all) => a - (i === 0 ? 0 : all[i - 1]));
  process.stdout.write(
    `  carriageway points: ${JSON.stringify(carriageways)}\n` +
      `  centerline: ${centerline.length} vertices, ${boundaries[boundaries.length - 1].alongM} m, ` +
      `spacing ${Math.round(Math.min(...spacing))}-${Math.round(Math.max(...spacing))} m\n` +
      `  boundaries: ${boundaries.map((b) => `${b.name} ${b.alongM}`).join(", ")}\n`,
  );
  if (args.dryRun) return;
  fs.mkdirSync(path.dirname(LANE_FILE), { recursive: true });
  fs.writeFileSync(LANE_FILE, `${JSON.stringify(lane, null, 2)}\n`);
  process.stdout.write(`  wrote ${path.relative(ROOT, LANE_FILE)}\n`);
}


async function checkProbe(lane, source) {
  const { centerline, boundaries } = lane.corridor;
  const along = cumulative(centerline);
  const alongOf = new Map(boundaries.map((b) => [b.name, b.alongM]));
  const totals = { inRange: 0, onCorridor: 0, maxDistanceM: 0, wrongSide: 0 };
  for (const route of lane.probeRoutes) {
    const dir = source === "live" ? null : source;
    const stations = await readOrFetch(args.topisDir, "arrive", "arrive/getArrInfoByRouteAll", route.routeId).catch(() => null);
    const nameByOrd = new Map((stations?.msgBody.itemList ?? []).map((s) => [Number(s.staOrd), stationName(s)]));
    const body = await readOrFetch(dir, "buspos", "buspos/getBusPosByRtid", route.routeId);
    for (const bus of body.msgBody.itemList ?? []) {
      const sectOrd = Number(bus.sectOrd);
      const direction = Object.entries(route.sectOrds).find(([, r]) => sectOrd >= r.from && sectOrd <= r.to)?.[0];
      if (!direction) continue;
      totals.inRange++;
      const p = project(centerline, along, { lat: Number(bus.gpsY), lng: Number(bus.gpsX) });
      const on = p.distanceM <= ON_CORRIDOR_M;
      // A bus past station N toward N+1: southbound its along lies after N's boundary and before N+1's; northbound the reverse.
      const behind = alongOf.get(nameByOrd.get(sectOrd));
      const ahead = alongOf.get(nameByOrd.get(sectOrd + 1));
      const sign = direction === "southbound" ? 1 : -1;
      const wrongSide =
        on &&
        ((behind !== undefined && sign * (p.alongM - behind) < -STATION_SIDE_TOLERANCE_M) ||
          (ahead !== undefined && sign * (ahead - p.alongM) < -STATION_SIDE_TOLERANCE_M));
      if (on) {
        totals.onCorridor++;
        totals.maxDistanceM = Math.max(totals.maxDistanceM, p.distanceM);
      }
      if (wrongSide) totals.wrongSide++;
      process.stdout.write(
        `  ${route.name} ${bus.vehId} sect ${sectOrd} (${nameByOrd.get(sectOrd) ?? "?"} → ${nameByOrd.get(sectOrd + 1) ?? "?"}) ` +
          `${direction} ${Math.round(p.distanceM)} m off, along ${Math.round(p.alongM)} m${on ? "" : " (off corridor)"}${wrongSide ? " WRONG SIDE" : ""}\n`,
      );
    }
  }
  process.stdout.write(`  ${JSON.stringify({ ...totals, maxDistanceM: Math.round(totals.maxDistanceM) })}\n`);
  if (totals.wrongSide > 0) process.exitCode = 1;
}

// Inside the 2 calls each, the stops of 인자셔틀 (src/bus/stops/schedule-stops.json).
const CHECK_TRIPS = {
  southbound: { start: { lat: 37.587367, lng: 126.993643 }, goal: { lat: 37.292298, lng: 126.975057 } },
  northbound: { start: { lat: 37.292536, lng: 126.975077 }, goal: { lat: 37.587258, lng: 126.993904 } },
};

const lngLat = (p) => `${p.lng},${p.lat}`;

async function naverRoute(start, waypoints, goal) {
  const query = new URLSearchParams({ start: lngLat(start), goal: lngLat(goal), waypoints: waypoints.map(lngLat).join("|"), option: "traoptimal" });
  const res = await fetch(`${NAVER_URL}?${query}`, {
    headers: { "X-NCP-APIGW-API-KEY-ID": requireEnv("NAVER_API_KEY_ID"), "X-NCP-APIGW-API-KEY": requireEnv("NAVER_API_KEY") },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`NAVER: HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== 0) throw new Error(`NAVER: code ${body.code} ${body.message}`);
  return body.route.traoptimal[0];
}

async function checkEntryExit(lane) {
  for (const [direction, { entry, exit }] of Object.entries(lane.entryExit)) {
    const trip = CHECK_TRIPS[direction];
    const route = await naverRoute(trip.start, [entry, exit], trip.goal);
    const points = route.path.map(([lng, lat]) => ({ lat, lng }));
    const along = cumulative(points);
    const waypointGuides = route.guide.filter((g) => g.type === 87);
    const vias = [entry, exit].map((p, i) => {
      const nearest = project(points, along, p);
      const guide = waypointGuides[i];
      const atGuide = guide ? haversineM(points[guide.pointIndex], p) : NaN;
      return { distanceM: Math.round(nearest.distanceM), guideDistanceM: Math.round(atGuide) };
    });
    const legs = route.summary.waypoints
      ? [...route.summary.waypoints.map((w) => ({ distanceM: w.distance, durationS: Math.round(w.duration / 1000) }))]
      : [];
    const uTurns = route.guide.filter((g) => /유턴|U턴/.test(g.instructions));
    const roadNames = [...new Set(route.section.map((s) => s.name))];
    const between = route.guide.slice(
      route.guide.indexOf(waypointGuides[0]),
      route.guide.indexOf(waypointGuides[1]) + 1,
    );
    process.stdout.write(
      `  ${direction}: ${route.summary.distance} m, ${Math.round(route.summary.duration / 60000)} min, ` +
        `vias ${JSON.stringify(vias)}, waypoint guides ${waypointGuides.length}, u-turns ${uTurns.length}\n` +
        `    legs: ${JSON.stringify(legs)}\n` +
        `    sections: ${roadNames.join(" / ")}\n` +
        `    between entry and exit: ${between.map((g) => g.instructions).join(" | ")}\n`,
    );
    const far = vias.some((v) => v.distanceM > VIA_POINT_MAX_M || !(v.guideDistanceM <= VIA_POINT_MAX_M));
    if (far || uTurns.length > 0 || waypointGuides.length !== 2) process.exitCode = 1;
  }
}

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args.checkProbe) return checkProbe(readLaneFile(), args.checkProbe);
  if (args.checkEntryExit) return checkEntryExit(readLaneFile());
  return build(args);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
