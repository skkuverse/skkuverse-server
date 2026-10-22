import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import { createCachedLoader } from "../infra/cached-loader";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { mongoCollection } from "../infra/mongo";
import type { SubwayArrivalsDoc } from "./subway.document";

// WHY: each api replica answers a burst of requests from one read per 2 s; the tracker rewrites
// the documents every 10 s, so an arrival is never staler than its countdown can show.
const ARRIVALS_TTL_MS = 2_000;

@Injectable()
export class SubwayRepository {
  private readonly arrivals = createCachedLoader({
    name: "subway.subway_arrivals",
    ttlMs: ARRIVALS_TTL_MS,
    load: () => this.subwayArrivals().find({}, { maxTimeMS: HOT_READ_MAX_TIME_MS }).toArray(),
  });

  async upsertArrivals(docs: readonly SubwayArrivalsDoc[]): Promise<void> {
    if (docs.length === 0) return;
    const replacements = docs.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }));
    await this.subwayArrivals().bulkWrite(replacements, { ordered: false });
  }

  listArrivals(): Promise<readonly SubwayArrivalsDoc[]> {
    return this.arrivals.get();
  }

  private subwayArrivals(): Collection<SubwayArrivalsDoc> {
    return mongoCollection<SubwayArrivalsDoc>(config.mongo.dbName, config.subway.collections.arrivals);
  }
}
