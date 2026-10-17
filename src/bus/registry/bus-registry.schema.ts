import { z } from "zod";
import type { JongroRouteDocument } from "./bus-registry.document";
import { isLoopClosingRepeat } from "./bus-registry.rules";

type Issues = z.core.$RefinementCtx<StationsSeedFile>;
type IssuePath = Array<string | number>;

const NON_EMPTY = "required non-empty string";
const report = (ctx: Issues, path: IssuePath, message: string): void => ctx.addIssue({ code: "custom", path, message });

const seedStation = z.object({ topisId: z.string(), arsId: z.string(), stationName: z.string() });

const seedEntry = z.object({
  id: z.string(),
  turnaroundTopisId: z.string(),
  /** QUIRK(topis): the route's stops in TOPIS order, so stations[i] is TOPIS ord i + 1. */
  stations: z.array(seedStation),
});

const stationsSeedShape = z.array(seedEntry);

export type StationsSeedFile = z.output<typeof stationsSeedShape>;
type StationsSeedEntry = StationsSeedFile[number];

function checkStations(entry: StationsSeedEntry, at: IssuePath, ctx: Issues): void {
  const topisIds = entry.stations.map((station) => station.topisId);
  entry.stations.forEach((station, index) => {
    for (const field of ["topisId", "arsId", "stationName"] as const) {
      if (station[field].length === 0) report(ctx, [...at, "stations", index, field], NON_EMPTY);
    }
    if (station.topisId.length > 0 && topisIds.indexOf(station.topisId) < index && !isLoopClosingRepeat(topisIds, index)) {
      report(ctx, [...at, "stations", index, "topisId"], `duplicate "${station.topisId}" within route`);
    }
  });
  if (!topisIds.includes(entry.turnaroundTopisId)) {
    report(ctx, [...at, "turnaroundTopisId"], `"${entry.turnaroundTopisId}" is no station of the route`);
  }
}

export const stationsSeedFile = stationsSeedShape.superRefine((entries, ctx) => {
  const seenIds = new Set<string>();
  entries.forEach((entry, index) => {
    if (seenIds.has(entry.id)) report(ctx, [index, "id"], `duplicate "${entry.id}"`);
    seenIds.add(entry.id);
    if (entry.stations.length === 0) report(ctx, [index, "stations"], "required non-empty array");
    else checkStations(entry, [index], ctx);
  });
});

export const jongroRouteDocument = z.object({
  _id: z.string(),
  stations: z.array(seedStation.extend({ sequence: z.int() })),
  turnaroundTopisId: z.string(),
  stationsVersion: z.string(),
  syncedAt: z.date(),
}) satisfies z.ZodType<JongroRouteDocument>;
