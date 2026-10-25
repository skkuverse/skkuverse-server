import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import { createCachedLoader, type CachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import type { BusCacheDocument, BusCacheEntry, BusCacheKey, BusCacheValueByKey } from "./bus-cache.document";

// WHY: each replica answers a burst of realtime requests from one read per key per 5 s.
const MEMORY_TTL_MS = 5_000;
const MISSING_LOG_INTERVAL_MS = 60_000;

@Injectable()
export class BusCacheRepository implements OnModuleInit {
  private readonly loaders = new Map<BusCacheKey, CachedLoader<BusCacheEntry<BusCacheKey> | null>>();
  private readonly missingThrottle = createLogThrottle(MISSING_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(private readonly clock: Clock) {}

  // WHY: every ROLE ensures it: the poller writes bus_cache and the api replicas read it.
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("bus.cache", () => this.ensureIndexes());
  }

  async upsert<K extends BusCacheKey>(key: K, value: BusCacheValueByKey[K]): Promise<void> {
    await this.busCache().updateOne({ _id: key }, { $set: { data: value, _updatedAt: this.clock.now() } }, { upsert: true });
  }

  async findValue<K extends BusCacheKey>(key: K): Promise<BusCacheValueByKey[K] | null> {
    return (await this.findEntry(key))?.value ?? null;
  }

  findEntry<K extends BusCacheKey>(key: K): Promise<BusCacheEntry<K> | null> {
    return this.loaderOf(key).get() as Promise<BusCacheEntry<K> | null>;
  }

  private loaderOf(key: BusCacheKey): CachedLoader<BusCacheEntry<BusCacheKey> | null> {
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

  // WHY: MongoDB drops a key a minute after its last write, so a stopped poller empties bus_cache.
  private async ensureIndexes(): Promise<void> {
    await this.busCache().createIndex({ _updatedAt: 1 }, { expireAfterSeconds: 60, name: "ttl_updatedAt" });
  }

  private async loadValue(key: BusCacheKey): Promise<BusCacheEntry<BusCacheKey> | null> {
    const doc = await this.busCache().findOne({ _id: key });
    if (doc) return { value: doc.data, updatedAt: doc._updatedAt };
    this.warnMissing(key);
    return null;
  }

  // WHY: a missing key serves an empty list that reads as "no bus running"; this line shows a stopped writer
  // or a key typo. SEE: docs/explanation/bus-architecture.md ("Invariants")
  private warnMissing(key: BusCacheKey): void {
    const ticket = this.missingThrottle.take(key);
    if (!ticket) return;
    logger.warn({ event: "bus.cache.missing", key, suppressed: ticket.suppressed }, "bus_cache key missing: serving this process's own poller memory");
  }

  private busCache(): Collection<BusCacheDocument> {
    return mongoCollection<BusCacheDocument>(config.mongo.dbName, config.mongo.collections.busCache);
  }
}
