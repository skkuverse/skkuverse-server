import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../../infra/config";
import { ensureIndexesAtBoot, mongoCollection } from "../../../infra/mongo";
import type { BusLaneSpanDoc } from "./bus-eta-probe.document";

const COLLECTION = "bus_lane_spans";

@Injectable()
export class BusEtaProbeRepository implements OnModuleInit {
  // WHY: SHUTTLE_ETA=off (the development default) touches no collection; the TTL index ends each span's 90 days.
  onModuleInit(): Promise<void> {
    if (!config.shuttleEta.enabled) return Promise.resolve();
    return ensureIndexesAtBoot("bus.eta.probe", () => this.ensureIndexes());
  }

  // WHY: a replace by `_id`, so a span recorded twice (the same pair seen again after a restart) is stored once.
  async recordSpans(spans: BusLaneSpanDoc[]): Promise<number> {
    if (spans.length === 0) return 0;
    await this.spans().bulkWrite(
      spans.map((span) => ({ replaceOne: { filter: { _id: span._id }, replacement: span, upsert: true } })),
      { ordered: false },
    );
    return spans.length;
  }

  private async ensureIndexes(): Promise<void> {
    await this.spans().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });
  }

  private spans(): Collection<BusLaneSpanDoc> {
    return mongoCollection<BusLaneSpanDoc>(config.mongo.dbName, COLLECTION);
  }
}
