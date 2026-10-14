import { z } from "zod";
import { isHex6 } from "../infra/color";
import { JONGRO_ROUTE_ID_PATTERN } from "./bus.constants";
import { isLoopClosingRepeat } from "./bus.rules";
import { jongroRoutesFile, type JongroRoutesFile } from "./bus.wire";

type JongroRouteEntry = JongroRoutesFile[number];
type Issues = z.core.$RefinementCtx<JongroRoutesFile>;
type IssuePath = Array<string | number>;

const report = (ctx: Issues, path: IssuePath, message: string): void => {
  ctx.addIssue({ code: "custom", path, message });
};

function checkEntryFields(entry: JongroRouteEntry, at: IssuePath, ctx: Issues): void {
  if (entry.busRouteId.length === 0) report(ctx, [...at, "busRouteId"], "required non-empty string");
  if (!isHex6(entry.themeColor)) report(ctx, [...at, "themeColor"], "must be 6-char hex string");
  if (entry.iconType.length === 0) report(ctx, [...at, "iconType"], "required non-empty string");
  if (!(entry.refreshInterval > 0)) report(ctx, [...at, "refreshInterval"], "required positive number");
}

function checkStations(entry: JongroRouteEntry, at: IssuePath, ctx: Issues): void {
  const topisIds = entry.stations.map((s) => s.topisId);
  const seen = new Set<string>();
  entry.stations.forEach((s, j) => {
    const sp = [...at, "stations", j];
    if (s.stationName.length === 0) report(ctx, [...sp, "stationName"], "required non-empty string");
    if (s.arsId.length === 0) report(ctx, [...sp, "arsId"], "required non-empty string");
    if (s.topisId.length === 0) report(ctx, [...sp, "topisId"], "required non-empty string");
    else if (seen.has(s.topisId) && !isLoopClosingRepeat(topisIds, j)) {
      report(ctx, [...sp, "topisId"], `duplicate "${s.topisId}" within route`);
    }
    seen.add(s.topisId);
    s.transferLines.forEach((t, k) => {
      if (t.line.length === 0) report(ctx, [...sp, "transferLines", k, "line"], "required non-empty string");
      if (!isHex6(t.color)) report(ctx, [...sp, "transferLines", k, "color"], "must be 6-char hex string");
    });
  });
}

// WHY: a station's sequence is its index + 1, so the first and last markers must sit at the two ends.
function checkEnds(entry: JongroRouteEntry, at: IssuePath, ctx: Issues): void {
  const last = entry.stations.length - 1;
  const firsts = entry.stations.flatMap((s, j) => (s.isFirstStation ? [j] : []));
  const lasts = entry.stations.flatMap((s, j) => (s.isLastStation ? [j] : []));
  if (firsts.length !== 1) report(ctx, at, `must have exactly 1 isFirstStation=true (got ${firsts.length})`);
  else if (firsts[0] !== 0) report(ctx, at, `isFirstStation=true must be at index 0 (got ${firsts[0]})`);
  if (lasts.length !== 1) report(ctx, at, `must have exactly 1 isLastStation=true (got ${lasts.length})`);
  else if (lasts[0] !== last) report(ctx, at, `isLastStation=true must be at index ${last} (got ${lasts[0]})`);
}

function checkEntry(entry: JongroRouteEntry, i: number, ctx: Issues): void {
  const at = [i];
  checkEntryFields(entry, at, ctx);
  if (entry.stations.length === 0) {
    report(ctx, [i, "stations"], "required non-empty array");
    return;
  }
  checkStations(entry, at, ctx);
  checkEnds(entry, at, ctx);
}

export const jongroRoutesConfig = jongroRoutesFile.superRefine((entries, ctx) => {
  const seenIds = new Set<string>();
  entries.forEach((entry, i) => {
    if (!JONGRO_ROUTE_ID_PATTERN.test(entry.id)) report(ctx, [i, "id"], `must match ${JONGRO_ROUTE_ID_PATTERN}`);
    else if (seenIds.has(entry.id)) report(ctx, [i, "id"], `duplicate "${entry.id}"`);
    seenIds.add(entry.id);
    checkEntry(entry, i, ctx);
  });
});
