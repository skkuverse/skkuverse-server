import { z } from "zod";
import { isHex6 } from "../infra/color";
import { JONGRO_ROUTE_ID_PATTERN } from "./bus.constants";
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

function checkTransferLines(entry: JongroRouteEntry, at: IssuePath, ctx: Issues): void {
  for (const [arsId, lines] of Object.entries(entry.transferLinesByArsId)) {
    const linesAt = [...at, "transferLinesByArsId", arsId];
    if (arsId.length === 0) report(ctx, linesAt, "ARS number must be a non-empty string");
    if (lines.length === 0) report(ctx, linesAt, "required non-empty array");
    lines.forEach((line, lineIndex) => {
      if (line.line.length === 0) report(ctx, [...linesAt, lineIndex, "line"], NON_EMPTY);
      if (!isHex6(line.color)) report(ctx, [...linesAt, lineIndex, "color"], HEX);
    });
  }
}

function checkEntry(entry: JongroRouteEntry, index: number, ctx: Issues): void {
  checkEntryFields(entry, [index], ctx);
  checkTransferLines(entry, [index], ctx);
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
