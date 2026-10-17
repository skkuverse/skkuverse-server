import { z } from "zod";
import { isHex6 } from "../infra/color";
import { JONGRO_ROUTE_ID_PATTERN } from "./bus.constants";
import { isLoopClosingRepeat } from "./bus.rules";
import { jongroRoutesFile, type JongroRoutesFile } from "./bus.wire";

type JongroRouteEntry = JongroRoutesFile[number];
type Issues = z.core.$RefinementCtx<JongroRoutesFile>;
type IssuePath = Array<string | number>;

const NON_EMPTY = "required non-empty string";
const HEX = "must be 6-char hex string";
const report = (ctx: Issues, path: IssuePath, message: string): void => ctx.addIssue({ code: "custom", path, message });

function checkEntryFields(entry: JongroRouteEntry, at: IssuePath, ctx: Issues): void {
  if (entry.busRouteId.length === 0) report(ctx, [...at, "busRouteId"], NON_EMPTY);
  if (!isHex6(entry.themeColor)) report(ctx, [...at, "themeColor"], HEX);
  if (entry.iconType.length === 0) report(ctx, [...at, "iconType"], NON_EMPTY);
  if (!(entry.refreshInterval > 0)) report(ctx, [...at, "refreshInterval"], "required positive number");
  if (!(Number.isInteger(entry.seatCount) && entry.seatCount > 0)) report(ctx, [...at, "seatCount"], "required positive integer");
}

function checkStations(entry: JongroRouteEntry, at: IssuePath, ctx: Issues): void {
  const topisIds = entry.stations.map((s) => s.topisId);
  const seen = new Set<string>();
  entry.stations.forEach((station, index) => {
    const stationAt = [...at, "stations", index];
    if (station.stationName.length === 0) report(ctx, [...stationAt, "stationName"], NON_EMPTY);
    if (station.arsId.length === 0) report(ctx, [...stationAt, "arsId"], NON_EMPTY);
    if (station.topisId.length === 0) report(ctx, [...stationAt, "topisId"], NON_EMPTY);
    else if (seen.has(station.topisId) && !isLoopClosingRepeat(topisIds, index)) {
      report(ctx, [...stationAt, "topisId"], `duplicate "${station.topisId}" within route`);
    }
    seen.add(station.topisId);
    station.transferLines.forEach((line, lineIndex) => {
      if (line.line.length === 0) report(ctx, [...stationAt, "transferLines", lineIndex, "line"], NON_EMPTY);
      if (!isHex6(line.color)) report(ctx, [...stationAt, "transferLines", lineIndex, "color"], HEX);
    });
  });
}

// WHY: a station's sequence is its index + 1, so the first and last markers must sit at the two ends.
function checkEnds(entry: JongroRouteEntry, at: IssuePath, ctx: Issues): void {
  const last = entry.stations.length - 1;
  const firsts = entry.stations.flatMap((station, index) => (station.isFirstStation ? [index] : []));
  const lasts = entry.stations.flatMap((station, index) => (station.isLastStation ? [index] : []));
  if (firsts.length !== 1) report(ctx, at, `must have exactly 1 isFirstStation=true (got ${firsts.length})`);
  else if (firsts[0] !== 0) report(ctx, at, `isFirstStation=true must be at index 0 (got ${firsts[0]})`);
  if (lasts.length !== 1) report(ctx, at, `must have exactly 1 isLastStation=true (got ${lasts.length})`);
  else if (lasts[0] !== last) report(ctx, at, `isLastStation=true must be at index ${last} (got ${lasts[0]})`);
}

function checkEntry(entry: JongroRouteEntry, index: number, ctx: Issues): void {
  checkEntryFields(entry, [index], ctx);
  if (entry.stations.length === 0) return report(ctx, [index, "stations"], "required non-empty array");
  checkStations(entry, [index], ctx);
  checkEnds(entry, [index], ctx);
}

export const jongroRoutesConfig = jongroRoutesFile.superRefine((entries, ctx) => {
  const seenIds = new Set<string>();
  entries.forEach((entry, index) => {
    if (!JONGRO_ROUTE_ID_PATTERN.test(entry.id)) report(ctx, [index, "id"], `must match ${JONGRO_ROUTE_ID_PATTERN}`);
    else if (seenIds.has(entry.id)) report(ctx, [index, "id"], `duplicate "${entry.id}"`);
    seenIds.add(entry.id);
    checkEntry(entry, index, ctx);
  });
});
