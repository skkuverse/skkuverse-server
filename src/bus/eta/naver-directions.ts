/**
 * NAVER Directions 5 (driving, real-time traffic): one call for a whole stop
 * sequence, read as the travel time from the first stop to each stop.
 *
 * The sequence is sent as start (stop 0), waypoints (the stops in between) and
 * goal (the last stop). `guide[]` lists the route's turn points, each with the
 * `duration` (ms) since the previous one; a waypoint appears as one `type: 87`
 * entry and the goal as the `type: 88` entry, so the running sum up to each of
 * them is that stop's travel time. Probed on 2026-10-09 (tasks.md 9.1): the
 * guide durations sum to exactly `summary.duration`.
 *
 * A route is rejected, never stored, when it fails the checks of spec
 * "Implausible routes are rejected" — notably when a stop lies more than
 * 150 m from where the route places it, which is what a router that avoids
 * campus roads and drops a stop on an outside road looks like.
 */
import axios from "axios";
import { haversineM } from "../schedule/schedule-stops";
import type { LatLng } from "../types";
import { DirectionsError, withOneRetry } from "./directions-error";

export interface NaverDirectionsGuide {
  pointIndex: number;
  type: number;
  instructions?: string;
  distance: number;
  duration: number;
}

export interface NaverDirectionsSummary {
  duration: number;
  distance: number;
  [k: string]: unknown;
}

export interface NaverDirectionsResponse {
  code: number;
  message: string;
  route?: {
    traoptimal?: Array<{
      summary: NaverDirectionsSummary;
      // [lng, lat]
      path: Array<[number, number]>;
      guide: NaverDirectionsGuide[];
      [k: string]: unknown;
    }>;
    [k: string]: unknown;
  };
}

export interface NaverCredentials {
  keyId: string;
  key: string;
}

const ENDPOINT = "https://maps.apigw.ntruss.com/map-direction/v1/driving";
const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 3_000;
const GUIDE_WAYPOINT = 87;
const GUIDE_GOAL = 88;
const MAX_TOTAL_MISMATCH_MS = 30_000;
const MAX_STOP_DISTANCE_M = 150;

function implausible(message: string): DirectionsError {
  return new DirectionsError("naver", "implausible", message);
}

/**
 * Seconds from the first stop to each stop of `stops`, in order (the first is
 * 0). Throws a DirectionsError for a failed or implausible route.
 */
export function parseNaverOffsets(res: NaverDirectionsResponse, stops: readonly LatLng[]): number[] {
  if (res.code !== 0) throw new DirectionsError("naver", "api", `code ${res.code} (${res.message})`);
  const route = res.route?.traoptimal?.[0];
  if (!route) throw implausible("no traoptimal route in the response");

  const offsetsMs = [0];
  const pointIndexes = [0];
  let running = 0;
  let waypoints = 0;
  let goals = 0;
  for (const g of route.guide) {
    running += g.duration;
    if (g.type === GUIDE_WAYPOINT) waypoints += 1;
    else if (g.type === GUIDE_GOAL) goals += 1;
    else continue;
    offsetsMs.push(running);
    pointIndexes.push(g.pointIndex);
  }
  if (waypoints !== stops.length - 2 || goals !== 1) {
    throw implausible(`expected ${stops.length - 2} waypoint (87) and 1 goal (88) guide entries, got ${waypoints} and ${goals}`);
  }

  for (let k = 1; k < offsetsMs.length; k++) {
    if (offsetsMs[k]! < offsetsMs[k - 1]!) {
      throw implausible(`stop ${k} is reached before stop ${k - 1} (${offsetsMs[k]} ms < ${offsetsMs[k - 1]} ms)`);
    }
  }

  const total = offsetsMs[offsetsMs.length - 1]!;
  if (Math.abs(total - route.summary.duration) > MAX_TOTAL_MISMATCH_MS) {
    throw implausible(`the stop times add up to ${total} ms but the route total is ${route.summary.duration} ms`);
  }

  stops.forEach((stop, k) => {
    const point = route.path[pointIndexes[k]!];
    if (!point) throw implausible(`stop ${k} points past the end of the path (index ${pointIndexes[k]})`);
    const meters = haversineM({ lat: point[1], lng: point[0] }, stop);
    if (meters > MAX_STOP_DISTANCE_M) {
      throw implausible(`stop ${k} is ${Math.round(meters)} m from where the route places it (limit ${MAX_STOP_DISTANCE_M} m)`);
    }
  });

  return offsetsMs.map((ms) => Math.round(ms / 1000));
}

const lngLat = (p: LatLng) => `${p.lng},${p.lat}`;

/**
 * One real-time call for `stops` (2–7, the first the departure). Keys travel
 * in headers only. Retries once, 3 s later, on a timeout, a reset or a 5xx.
 */
export async function fetchNaverOffsets(
  stops: readonly LatLng[],
  credentials: NaverCredentials,
  opts: { retryDelayMs?: number } = {},
): Promise<number[]> {
  const params: Record<string, string> = {
    start: lngLat(stops[0]!),
    goal: lngLat(stops[stops.length - 1]!),
    option: "traoptimal",
  };
  if (stops.length > 2) params.waypoints = stops.slice(1, -1).map(lngLat).join("|");
  const res = await withOneRetry(
    "naver",
    () =>
      axios.get<NaverDirectionsResponse>(ENDPOINT, {
        params,
        headers: { "X-NCP-APIGW-API-KEY-ID": credentials.keyId, "X-NCP-APIGW-API-KEY": credentials.key },
        timeout: TIMEOUT_MS,
      }),
    opts.retryDelayMs ?? RETRY_DELAY_MS,
  );
  return parseNaverOffsets(res.data, stops);
}
