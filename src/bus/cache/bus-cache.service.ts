import { Injectable } from "@nestjs/common";
import { getClient } from "../../infra/db";
import config from "../../infra/config";

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

/**
 * Dual-layer bus cache.
 *
 * In-memory layer (default 5s TTL) over a Mongo `bus_cache` catch-all KV store
 * (TTL index 60s on `_updatedAt`). Uses the raw mongodb driver via
 * src/infra/db.ts getClient() + config.mongo (NOT Mongoose) so cache documents,
 * the `_id`-as-string key, and the TTL index name (`ttl_updatedAt`) match what
 * the collection already holds. Collection name honors the
 * MONGO_CACHE_COLLECTION override via config.mongo.collections.busCache.
 *
 * Each instance owns its own in-memory map; as a DI singleton that is one map
 * per process.
 */
@Injectable()
export class BusCacheService {
  // Collection generic intentionally untyped at this layer — bus_cache is a
  // catch-all key/value store.
  private memCache: Record<string, CacheEntry> = {};

  private getCollection() {
    return getClient()
      .db(config.mongo.dbName!)
      .collection(config.mongo.collections.busCache);
  }

  async ensureIndex(): Promise<void> {
    await this.getCollection().createIndex(
      { _updatedAt: 1 },
      { expireAfterSeconds: 60, name: "ttl_updatedAt" },
    );
  }

  async write(key: string, data: unknown): Promise<void> {
    // `_id` is a string key by design (cache namespace); cast through `never`.
    await this.getCollection().updateOne(
      { _id: key } as never,
      { $set: { data, _updatedAt: new Date() } },
      { upsert: true },
    );
  }

  async read(key: string): Promise<unknown> {
    const doc = await this.getCollection().findOne({ _id: key } as never);
    return doc ? doc.data : null;
  }

  // Read with a short in-memory cache (default 5s) to reduce MongoDB round-trips.
  async cachedRead(key: string, ttlMs = 5000): Promise<unknown> {
    const entry = this.memCache[key];
    if (entry && Date.now() < entry.expiresAt) {
      return entry.data;
    }
    const data = await this.read(key);
    this.memCache[key] = { data, expiresAt: Date.now() + ttlMs };
    return data;
  }
}
