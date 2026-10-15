/**
 * In-memory BusCacheRepository: one value per bus_cache key, as the real
 * upsert and read keep them (the real read's 5 s memory is pinned in
 * bus-cache.repository.spec.ts), typed by the key map so a test seeds only
 * a shape bus_cache can hold. `failWith` makes every call reject.
 */
import type { BusCacheKey, BusCacheValueByKey } from "../../../../src/bus/cache/bus-cache.document";
import type { BusCacheRepository } from "../../../../src/bus/cache/bus-cache.repository";
import type { PublicOf } from "../public-of";

export class FakeBusCacheRepository implements PublicOf<BusCacheRepository> {
  values = new Map<BusCacheKey, BusCacheValueByKey[BusCacheKey]>();
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async upsert<K extends BusCacheKey>(key: K, value: BusCacheValueByKey[K]): Promise<void> {
    this.fail();
    this.values.set(key, value);
  }

  async findValue<K extends BusCacheKey>(key: K): Promise<BusCacheValueByKey[K] | null> {
    this.fail();
    return (this.values.get(key) as BusCacheValueByKey[K] | undefined) ?? null;
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
