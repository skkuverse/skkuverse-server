import { Injectable } from "@nestjs/common";
import type { BusCacheEntry, BusCacheKey, BusCacheValueByKey } from "./bus-cache.document";
import { BusCacheRepository } from "./bus-cache.repository";

@Injectable()
export class BusCacheService {
  constructor(private readonly repository: BusCacheRepository) {}

  read<K extends BusCacheKey>(key: K): Promise<BusCacheValueByKey[K] | null> {
    return this.repository.findValue(key);
  }

  readEntry<K extends BusCacheKey>(key: K): Promise<BusCacheEntry<K> | null> {
    return this.repository.findEntry(key);
  }

  write<K extends BusCacheKey>(key: K, value: BusCacheValueByKey[K]): Promise<void> {
    return this.repository.upsert(key, value);
  }
}
