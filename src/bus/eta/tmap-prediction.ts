/**
 * TMAP 타임머신 자동차 길 안내: a forecast for a given departure time, built
 * from historical traffic, for a whole stop sequence in one call, read as the
 * travel time from the first stop to each stop.
 *
 * Probed on 2026-10-09 (tasks.md 9.1):
 * - `predictionType: "arrival"` takes the departure time and forecasts the
 *   arrival; `"departure"` works backwards from an arrival time.
 * - The response is a GeoJSON FeatureCollection. The first Point (`S`) carries
 *   `totalTime` in seconds, each LineString the `time` (s) of its segment, and
 *   the segment times sum to exactly `totalTime`. A waypoint is a `B1`, `B2`…
 *   Point and the goal the `E` Point, so the running sum up to each of them is
 *   that stop's travel time.
 * - After `E`, TMAP echoes every waypoint as sent: a bare `B1` Point without
 *   `index`. Reading stops at `E`, so the echo is never counted.
 *
 * TMAP's terms forbid using its data more than 24 hours after storing it, so
 * a baseline expires 24 h after its fetch (`baselineDoc`), and the test
 * fixture is synthetic.
 */
import axios from "axios";
import moment from "moment-timezone";
import { haversineM } from "../schedule/schedule-stops";
import type { LatLng } from "../types";
import { DirectionsError, withOneRetry } from "./directions-error";

export interface TmapFeature {
  type: "Feature";
  // [lng, lat]
  geometry: { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: Array<[number, number]> };
  properties: {
    index?: number;
    pointType?: string;
    time?: number;
    totalTime?: number;
    [k: string]: unknown;
  };
}

export interface TmapPredictionResponse {
  type: string;
  features?: TmapFeature[];
}

const ENDPOINT = "https://apis.openapi.sk.com/tmap/routes/prediction";
const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 3_000;
const MAX_TOTAL_MISMATCH_S = 30;
const MAX_STOP_DISTANCE_M = 150;

function implausible(message: string): DirectionsError {
  return new DirectionsError("tmap", "implausible", message);
}

/**
 * Seconds from the first stop to each stop of `stops`, in order (the first is
 * 0). Throws a DirectionsError for a failed or implausible route.
 */
export function parseTmapOffsets(res: TmapPredictionResponse, stops: readonly LatLng[]): number[] {
  const features = res.features;
  const start = features?.[0];
  if (!start || start.properties.pointType !== "S" || typeof start.properties.totalTime !== "number") {
    throw new DirectionsError("tmap", "api", "no route in the response");
  }
  const totalTime = start.properties.totalTime;

  const offsets = [0];
  const marks: Array<[number, number]> = [start.geometry.coordinates as [number, number]];
  let running = 0;
  let waypoints = 0;
  let ended = false;
  for (const f of features) {
    const p = f.properties;
    if (f.geometry.type === "LineString") {
      running += p.time ?? 0;
      continue;
    }
    if (p.pointType === "E") {
      ended = true;
    } else if (p.pointType === `B${waypoints + 1}`) {
      waypoints += 1;
    } else {
      continue;
    }
    offsets.push(running);
    marks.push(f.geometry.coordinates);
    if (ended) break;
  }
  if (waypoints !== stops.length - 2 || !ended) {
    throw implausible(
      `expected ${stops.length - 2} waypoint (B1…) and 1 end (E) points, got ${waypoints} and ${ended ? 1 : 0}`,
    );
  }

  for (let k = 1; k < offsets.length; k++) {
    if (offsets[k]! < offsets[k - 1]!) {
      throw implausible(`stop ${k} is reached before stop ${k - 1} (${offsets[k]} s < ${offsets[k - 1]} s)`);
    }
  }

  const total = offsets[offsets.length - 1]!;
  if (Math.abs(total - totalTime) > MAX_TOTAL_MISMATCH_S) {
    throw implausible(`the stop times add up to ${total} s but the route total is ${totalTime} s`);
  }

  stops.forEach((stop, k) => {
    const [lng, lat] = marks[k]!;
    const meters = haversineM({ lat, lng }, stop);
    if (meters > MAX_STOP_DISTANCE_M) {
      throw implausible(`stop ${k} is ${Math.round(meters)} m from where the route places it (limit ${MAX_STOP_DISTANCE_M} m)`);
    }
  });

  return offsets.map((s) => Math.round(s));
}

const place = (name: string, p: LatLng) => ({ name, lon: String(p.lng), lat: String(p.lat) });

/**
 * One forecast for `stops` (2–7, the first the departure) leaving at
 * `departAt`. The app key travels in a header only. Retries once, 3 s later,
 * on a timeout, a reset or a 5xx.
 */
export async function fetchTmapOffsets(
  stops: readonly LatLng[],
  departAt: Date,
  appKey: string,
  opts: { retryDelayMs?: number } = {},
): Promise<number[]> {
  const routesInfo: Record<string, unknown> = {
    departure: place("stop0", stops[0]!),
    destination: place(`stop${stops.length - 1}`, stops[stops.length - 1]!),
    predictionType: "arrival",
    predictionTime: moment(departAt).tz("Asia/Seoul").format("YYYY-MM-DDTHH:mm:ssZZ"),
    searchOption: "00",
    trafficInfo: "N",
  };
  if (stops.length > 2) {
    routesInfo.wayPoints = { wayPoint: stops.slice(1, -1).map((p) => ({ lon: String(p.lng), lat: String(p.lat) })) };
  }
  const res = await withOneRetry(
    "tmap",
    () =>
      axios.post<TmapPredictionResponse>(
        ENDPOINT,
        { routesInfo },
        {
          params: { version: 1, reqCoordType: "WGS84GEO", resCoordType: "WGS84GEO", sort: "index", totalValue: 1 },
          headers: { appKey, Accept: "application/json", "Content-Type": "application/json" },
          timeout: TIMEOUT_MS,
        },
      ),
    opts.retryDelayMs ?? RETRY_DELAY_MS,
  );
  return parseTmapOffsets(res.data, stops);
}
