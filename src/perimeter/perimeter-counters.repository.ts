import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import { Clock } from "../infra/clock";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { ensureIndexesAtBoot, mongoCollection } from "../infra/mongo";
import type { PerimeterCounterDoc } from "./perimeter-counters.document";
import { toCounterWindow } from "./perimeter-counters.rules";

const PERIMETER_COUNTERS_COLLECTION = "perimeter_counters";

// WHY: the shared counts behind PerimeterCounters: one upserted document per key and window, removed by the TTL
// index once the window ends.
@Injectable()
export class PerimeterCountersRepository implements OnModuleInit {
  constructor(private readonly clock: Clock) {}

  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("perimeter.counters", () => this.ensureIndexes());
  }

  async upsertCount(key: string, windowSeconds: number): Promise<number> {
    const { counterId, expiresAt } = toCounterWindow(key, windowSeconds, this.clock.now());
    const counter = await this.counters().findOneAndUpdate(
      { _id: counterId },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: "after", maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
    if (counter === null) throw new Error(`perimeter counter ${counterId} was not returned by its upsert`);
    return counter.count;
  }

  private async ensureIndexes(): Promise<void> {
    await this.counters().createIndex({ expiresAt: 1 }, { name: "perimeter_counters_ttl", expireAfterSeconds: 0 });
  }

  private counters(): Collection<PerimeterCounterDoc> {
    return mongoCollection<PerimeterCounterDoc>(config.mongo.dbName, PERIMETER_COUNTERS_COLLECTION);
  }
}
