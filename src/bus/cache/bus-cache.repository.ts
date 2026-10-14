import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import { createCachedLoader, type CachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { mongoCollection } from "../../infra/mongo";
import type { BusCacheDocument, BusCacheKey, BusCacheValueByKey } from "./bus-cache.document";

// WHY: each replica answers a burst of realtime requests from one read per key per 5 s.
const MEMORY_TTL_MS = 5_000;

@Injectable()
export class BusCacheRepository {
  private readonly loaders = new Map<BusCacheKey, CachedLoader<BusCacheValueByKey[BusCacheKey] | null>>();

  constructor(private readonly clock: Clock) {}

  async ensureIndex(): Promise<void> {
    await this.busCache().createIndex({ _updatedAt: 1 }, { expireAfterSeconds: 60, name: "ttl_updatedAt" });
  }

  async upsert<K extends BusCacheKey>(key: K, value: BusCacheValueByKey[K]): Promise<void> {
    await this.busCache().updateOne({ _id: key }, { $set: { data: value, _updatedAt: this.clock.now() } }, { upsert: true });
  }

  findValue<K extends BusCacheKey>(key: K): Promise<BusCacheValueByKey[K] | null> {
    return this.loaderOf(key).get() as Promise<BusCacheValueByKey[K] | null>;
  }

  private loaderOf(key: BusCacheKey): CachedLoader<BusCacheValueByKey[BusCacheKey] | null> {
    const existing = this.loaders.get(key);
    if (existing) return existing;
    const loader = createCachedLoader({
      name: `bus_cache.${key}`,
      ttlMs: MEMORY_TTL_MS,
      load: () => this.loadValue(key),
      // WHY: the memory bounds bus_cache reads per replica rather than staleness, so CACHE=off keeps it.
      keepWhenCacheOff: true,
    });
    this.loaders.set(key, loader);
    return loader;
  }

  private async loadValue(key: BusCacheKey): Promise<BusCacheValueByKey[BusCacheKey] | null> {
    const doc = await this.busCache().findOne({ _id: key });
    return doc ? doc.data : null;
  }

  private busCache(): Collection<BusCacheDocument> {
    return mongoCollection<BusCacheDocument>(config.mongo.dbName!, config.mongo.collections.busCache);
  }
}
