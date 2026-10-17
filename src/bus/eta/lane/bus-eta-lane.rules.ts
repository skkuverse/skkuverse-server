import { haversineM } from "../../../shared/distance.util";
import type { LatLng } from "../../../shared/lat-lng.types";
import { projectOntoPolyline } from "../../../shared/polyline.util";
import type { EtaRun } from "../bus-eta.types";
import type {
  CorridorEnds,
  LaneConfig,
  LaneConfigIssue,
  LaneCorridor,
  LegBounds,
  ProbeRoute,
  SequenceKey,
  SequenceStrategy,
} from "./bus-eta-lane.types";

// WHY: the corridor script writes the last boundary as the length rounded to the meter; a larger gap means the
// centerline changed without its boundaries.
const MAX_END_MISMATCH_M = 1;

const CAR: SequenceStrategy = { strategy: "car" };

export function strategyOf(strategies: LaneConfig["strategies"], { serviceId, routeType }: SequenceKey): SequenceStrategy {
  return strategies[serviceId]?.[routeType] ?? CAR;
}

export function strategyIssues(strategies: LaneConfig["strategies"], sequences: readonly SequenceKey[]): LaneConfigIssue[] {
  const estimated = new Set(sequences.map((s) => `${s.serviceId} ${s.routeType}`));
  return Object.entries(strategies).flatMap(([serviceId, byRouteType]) =>
    Object.keys(byRouteType)
      .filter((routeType) => !estimated.has(`${serviceId} ${routeType}`))
      .map((routeType) => ({
        path: ["strategies", serviceId, routeType],
        message: `"${serviceId} ${routeType}" is not an estimated sequence; only an estimated one takes a strategy`,
      })),
  );
}

function centerlineLengthM(centerline: readonly LatLng[]): number {
  return centerline.reduce((sum, point, i) => (i === 0 ? sum : sum + haversineM(centerline[i - 1] ?? point, point)), 0);
}

function boundaryIssues({ centerline, boundaries }: LaneConfig["corridor"]): LaneConfigIssue[] {
  const at = (index: number) => ["corridor", "boundaries", index, "alongM"];
  const issues: LaneConfigIssue[] = [];
  const first = boundaries[0];
  if (first && first.alongM !== 0) issues.push({ path: at(0), message: `"${first.name}" must be at 0 m, the centerline's start, not ${first.alongM} m` });
  for (const [index, boundary] of boundaries.entries()) {
    const previous = boundaries[index - 1];
    if (previous && boundary.alongM <= previous.alongM) {
      issues.push({ path: at(index), message: `"${boundary.name}" (${boundary.alongM} m) must lie past "${previous.name}" (${previous.alongM} m)` });
    }
  }
  const lengthM = Math.round(centerlineLengthM(centerline));
  const last = boundaries[boundaries.length - 1];
  if (last && boundaries.length > 1 && Math.abs(last.alongM - lengthM) > MAX_END_MISMATCH_M) {
    issues.push({ path: at(boundaries.length - 1), message: `"${last.name}" must be at the centerline's end, ${lengthM} m, not ${last.alongM} m` });
  }
  return issues;
}

function probeRouteIssues(route: ProbeRoute, index: number, earlier: readonly ProbeRoute[]): LaneConfigIssue[] {
  const issues: LaneConfigIssue[] = [];
  const { southbound, northbound } = route.sectOrds;
  for (const [direction, range] of Object.entries(route.sectOrds)) {
    if (range.from > range.to) issues.push({ path: ["probeRoutes", index, "sectOrds", direction], message: `${route.name}: from ${range.from} is after to ${range.to}` });
  }
  if (earlier.some((other) => other.routeId === route.routeId)) {
    issues.push({ path: ["probeRoutes", index, "routeId"], message: `${route.name}: route ${route.routeId} is listed twice` });
  }
  if (southbound.from <= northbound.to && northbound.from <= southbound.to) {
    issues.push({ path: ["probeRoutes", index, "sectOrds"], message: `${route.name}: the southbound and northbound ranges share a section, so it has no single direction` });
  }
  return issues;
}

export function corridorIssues(config: LaneConfig): LaneConfigIssue[] {
  const { from, to } = config.laneHours;
  const hours = from < to ? [] : [{ path: ["laneHours"], message: `from ${from} must be before to ${to}` }];
  const routes = config.probeRoutes.flatMap((route, i) => probeRouteIssues(route, i, config.probeRoutes.slice(0, i)));
  return [...hours, ...boundaryIssues(config.corridor), ...routes];
}

/** WHY: lane hours compare the run's KST departure, `from` inclusive and `to` exclusive, so a 21:00 run is a car run. */
export function strategyOfRun(config: Pick<LaneConfig, "strategies" | "laneHours">, run: SequenceKey & Pick<EtaRun, "time">): SequenceStrategy {
  const strategy = strategyOf(config.strategies, run);
  const { from, to } = config.laneHours;
  return strategy.strategy === "busLane" && run.time >= from && run.time < to ? strategy : CAR;
}

export function toLegBounds(corridor: LaneCorridor, ends: CorridorEnds): LegBounds {
  const alongOf = (point: LatLng) => projectOntoPolyline(corridor.centerline, point).alongM;
  return { fromAlongM: alongOf(ends.entry), toAlongM: alongOf(ends.exit) };
}
