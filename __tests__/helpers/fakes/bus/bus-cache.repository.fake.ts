/**
 * In-memory BusCacheRepository: one value per bus_cache key, as the real
 * upsert and read keep them (the real read's 5 s memory is pinned in
 * bus-cache.repository.spec.ts), typed by the key map so a test seeds only
 * a shape bus_cache can hold. `failWith` makes every call reject.
 *
 * Each key's write instant is `updatedAtByKey`'s, else `writtenAt`: an upsert
 * stamps `writtenAt`, as the real one stamps its clock's time, and a value a
 * test seeds through `values` reads as written then too.
 */
import type { BusCacheEntry, BusCacheKey, BusCacheValueByKey } from "../../../../src/bus/cache/bus-cache.document";
import type { BusCacheRepository } from "../../../../src/bus/cache/bus-cache.repository";
import type { PublicOf } from "../public-of";

export class FakeBusCacheRepository implements PublicOf<BusCacheRepository> {
  values = new Map<BusCacheKey, BusCacheValueByKey[BusCacheKey]>();
  updatedAtByKey = new Map<BusCacheKey, Date>();
  writtenAt = new Date("2026-10-20T01:00:00Z");
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async upsert<K extends BusCacheKey>(key: K, value: BusCacheValueByKey[K]): Promise<void> {
    this.fail();
    this.values.set(key, value);
    this.updatedAtByKey.set(key, this.writtenAt);
  }

  async findValue<K extends BusCacheKey>(key: K): Promise<BusCacheValueByKey[K] | null> {
    return (await this.findEntry(key))?.value ?? null;
  }

  async findEntry<K extends BusCacheKey>(key: K): Promise<BusCacheEntry<K> | null> {
    this.fail();
    const value = this.values.get(key) as BusCacheValueByKey[K] | undefined;
    return value === undefined ? null : { value, updatedAt: this.updatedAtByKey.get(key) ?? this.writtenAt };
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
