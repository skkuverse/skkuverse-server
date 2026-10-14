import { Injectable } from "@nestjs/common";
import type { BusCacheKey, BusCacheValueByKey } from "./bus-cache.document";
import { BusCacheRepository } from "./bus-cache.repository";

@Injectable()
export class BusCacheService {
  constructor(private readonly repository: BusCacheRepository) {}

  read<K extends BusCacheKey>(key: K): Promise<BusCacheValueByKey[K] | null> {
    return this.repository.findValue(key);
  }

  write<K extends BusCacheKey>(key: K, value: BusCacheValueByKey[K]): Promise<void> {
    return this.repository.upsert(key, value);
  }
}
