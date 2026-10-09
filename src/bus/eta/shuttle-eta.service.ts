import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import { readUnexpiredEtas, type ShuttleEtaDoc } from "./eta-store";

export type EtaSource = "frozen" | "live" | "predicted";

/** The estimate a run is served with: travel times and where they came from. */
export interface ServedEstimate {
  offsetsSec: number[];
  source: EtaSource;
  updatedAt: Date;
}

// A real-time value describes traffic now; past this it no longer does.
const LIVE_MAX_AGE_MS = 15 * 60_000;

/** `serviceId|routeType|date|time`: one run, whatever its source. */
export function runKey(serviceId: string, routeType: string, date: string, time: string): string {
  return `${serviceId}|${routeType}|${date}|${time}`;
}

const RANK: Record<EtaSource, number> = { frozen: 3, live: 2, predicted: 1 };

function sourceOf(doc: ShuttleEtaDoc, now: Date): EtaSource | null {
  if (doc.expiresAt.getTime() <= now.getTime()) return null;
  if (doc.kind === "baseline") return "predicted";
  if (doc.frozen) return "frozen";
  return now.getTime() - doc.fetchedAt.getTime() <= LIVE_MAX_AGE_MS ? "live" : null;
}

/**
 * The best estimate per run (design D8): the fixed value, then a live value at
 * most 15 minutes old, then an unexpired prediction. A run with none of them
 * has no entry.
 */
export function pickEstimates(docs: readonly ShuttleEtaDoc[], now: Date): Map<string, ServedEstimate> {
  const best = new Map<string, ServedEstimate>();
  for (const doc of docs) {
    const source = sourceOf(doc, now);
    if (!source) continue;
    const key = runKey(doc.serviceId, doc.routeType, doc.date, doc.time);
    const current = best.get(key);
    if (!current || RANK[source] > RANK[current.source]) {
      best.set(key, { offsetsSec: doc.offsetsSec, source, updatedAt: doc.fetchedAt });
    }
  }
  return best;
}

/**
 * Serves stored arrival estimates to the smart schedule. Every unexpired
 * document (a few hundred) is read at most once per 30 s per replica, and an
 * outage keeps the last read in service for 10 minutes.
 */
@Injectable()
export class ShuttleEtaService {
  private readonly docs = createCachedLoader<ShuttleEtaDoc[]>({
    name: "shuttle-eta",
    ttlMs: 30_000,
    staleWindowMs: 10 * 60_000,
    load: () => readUnexpiredEtas(new Date()),
  });

  async estimates(now: Date = new Date()): Promise<Map<string, ServedEstimate>> {
    return pickEstimates(await this.docs.get(), now);
  }
}
