import { projectOntoPolyline } from "../../../shared/polyline.util";
import type { LaneCorridor, LaneDirection, LegBounds, ProbeRoute } from "../lane/bus-eta-lane.types";
import type { CorridorFix, LanePosition, LaneSpan, LegTime } from "./bus-eta-probe.types";

// EVIDENCE: the two carriageways lie 20–40 m apart and TOPIS GPS strays about as far; a city road beside the expressway is farther.
const MAX_CORRIDOR_OFFSET_M = 60;
const MINUTE_MS = 60_000;
// WHY: a ten-minute pair makes the 40–55 s GPS lag small against the distance it measures (design D5).
const PARTNER_AGE_MS = { min: 5 * MINUTE_MS, target: 10 * MINUTE_MS, max: 15 * MINUTE_MS };
const MIN_SPEED_KMH = 5;
// WHY: a bus stuck in a jam can read up to this far behind its earlier fix from GPS noise alone; more is no pair.
const MAX_BACKWARD_M = 100;
const BIN_M = 500;
const MIN_COVERAGE = 0.6;

function directionOfSection({ sectOrds }: ProbeRoute, sectOrd: number): LaneDirection | null {
  const directions = Object.entries(sectOrds) as Array<[LaneDirection, ProbeRoute["sectOrds"][LaneDirection]]>;
  return directions.find(([, range]) => sectOrd >= range.from && sectOrd <= range.to)?.[0] ?? null;
}

// WHY: the carriageways sit inside GPS noise of each other, so the route's section, not the geometry, gives the direction.
export function toCorridorFix(corridor: LaneCorridor, route: ProbeRoute, position: LanePosition): CorridorFix | null {
  const direction = directionOfSection(route, position.sectOrd);
  if (!direction) return null;
  const { alongM, offsetM } = projectOntoPolyline(corridor.centerline, position);
  return offsetM <= MAX_CORRIDOR_OFFSET_M ? { ...position, alongM, direction } : null;
}

function partnerOf(current: CorridorFix, earlier: readonly CorridorFix[]): CorridorFix | undefined {
  const ageOf = (fix: CorridorFix) => current.dataTm.getTime() - fix.dataTm.getTime();
  return earlier
    .filter((fix) => fix.vehId === current.vehId && fix.direction === current.direction)
    .filter((fix) => ageOf(fix) >= PARTNER_AGE_MS.min && ageOf(fix) <= PARTNER_AGE_MS.max)
    .sort((a, b) => Math.abs(ageOf(a) - PARTNER_AGE_MS.target) - Math.abs(ageOf(b) - PARTNER_AGE_MS.target))[0];
}

function toSpan(routeId: string, current: CorridorFix, partner: CorridorFix): LaneSpan | null {
  const forwardM = (current.alongM - partner.alongM) * (current.direction === "southbound" ? 1 : -1);
  if (forwardM < -MAX_BACKWARD_M) return null;
  const hours = (current.dataTm.getTime() - partner.dataTm.getTime()) / 3_600_000;
  const speedKmh = Math.max(MIN_SPEED_KMH, forwardM / 1000 / hours);
  const { vehId, direction } = current;
  return { routeId, vehId, direction, fromAlongM: partner.alongM, toAlongM: current.alongM, fromAt: partner.dataTm, toAt: current.dataTm, speedKmh };
}

export function toSpans(routeId: string, current: readonly CorridorFix[], earlier: readonly CorridorFix[]): LaneSpan[] {
  return current.flatMap((fix) => {
    const partner = partnerOf(fix, earlier);
    const span = partner ? toSpan(routeId, fix, partner) : null;
    return span ? [span] : [];
  });
}

const harmonicMean = (speeds: readonly number[]): number => speeds.length / speeds.reduce((sum, speed) => sum + 1 / speed, 0);

function coveredLengthM(ranges: ReadonlyArray<{ lo: number; hi: number }>): number {
  let coveredM = 0;
  let reachedM = -Infinity;
  for (const { lo, hi } of [...ranges].sort((a, b) => a.lo - b.lo)) {
    coveredM += Math.max(0, hi - Math.max(lo, reachedM));
    reachedM = Math.max(reachedM, hi);
  }
  return coveredM;
}

export function toLegTime(spans: readonly LaneSpan[], leg: LegBounds): LegTime {
  const start = Math.min(leg.fromAlongM, leg.toAlongM);
  const end = Math.max(leg.fromAlongM, leg.toAlongM);
  const ranges = spans
    .map((span) => ({ lo: Math.max(start, Math.min(span.fromAlongM, span.toAlongM)), hi: Math.min(end, Math.max(span.fromAlongM, span.toAlongM)), speedKmh: span.speedKmh }))
    .filter((range) => range.hi > range.lo);
  const coverage = coveredLengthM(ranges) / (end - start);
  if (ranges.length === 0) return { kind: "unavailable", reason: "noSpans", spanCount: 0, coverage };
  if (coverage < MIN_COVERAGE) return { kind: "unavailable", reason: "lowCoverage", spanCount: ranges.length, coverage };
  const bins = Array.from({ length: Math.ceil((end - start) / BIN_M) }, (_, binIndex) => {
    const lo = start + binIndex * BIN_M;
    const hi = Math.min(end, lo + BIN_M);
    const speeds = ranges.filter((range) => range.lo < hi && range.hi > lo).map((range) => range.speedKmh);
    return { lengthM: hi - lo, speedKmh: speeds.length > 0 ? harmonicMean(speeds) : null };
  });
  const fillKmh = harmonicMean(bins.flatMap((bin) => (bin.speedKmh === null ? [] : [bin.speedKmh])));
  const corridorSec = bins.reduce((sum, bin) => sum + (bin.lengthM / 1000 / (bin.speedKmh ?? fillKmh)) * 3600, 0);
  return { kind: "probe", corridorSec: Math.round(corridorSec), spanCount: ranges.length, coverage };
}
