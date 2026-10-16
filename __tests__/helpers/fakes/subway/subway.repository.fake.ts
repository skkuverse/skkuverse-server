/**
 * In-memory SubwayRepository: `docs` holds one `subway_arrivals` document per
 * station id, which upsertArrivals overwrites whole as the real bulk write
 * does, and listArrivals returns them all as the real read does (both pinned
 * in subway.repository.spec.ts). It does not cache: `replaces` counts the
 * writes; `failWith` makes every read reject.
 */
import type { SubwayArrivalsDoc } from "../../../../src/subway/subway.document";
import type { SubwayRepository } from "../../../../src/subway/subway.repository";
import type { PublicOf } from "../public-of";

const copyOf = (doc: SubwayArrivalsDoc): SubwayArrivalsDoc => ({
  ...doc,
  directions: { up: doc.directions.up.map((t) => ({ ...t })), down: doc.directions.down.map((t) => ({ ...t })) },
});

export class FakeSubwayRepository implements PublicOf<SubwayRepository> {
  docs = new Map<string, SubwayArrivalsDoc>();
  replaces = 0;
  failWith: Error | null = null;

  async upsertArrivals(docs: readonly SubwayArrivalsDoc[]): Promise<void> {
    if (docs.length === 0) return;
    this.replaces += 1;
    for (const doc of docs) this.docs.set(doc._id, copyOf(doc));
  }

  async listArrivals(): Promise<readonly SubwayArrivalsDoc[]> {
    if (this.failWith) throw this.failWith;
    return [...this.docs.values()].map(copyOf);
  }
}
