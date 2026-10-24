import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import { createCachedLoader, type CachedLoader } from "../../../infra/cached-loader";
import config from "../../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../../infra/db";
import { mongoCollection } from "../../../infra/mongo";
import type { BusSeatsDocument } from "./bus-realtime-gbis.document";

const COLLECTION = "bus_seats";
// WHY: each replica answers a burst of live requests from one read per route per 5 s, as bus_cache does.
const MEMORY_TTL_MS = 5_000;

@Injectable()
export class BusRealtimeGbisRepository {
  private readonly loaders = new Map<string, CachedLoader<BusSeatsDocument | null>>();

  async upsertSeats(seats: BusSeatsDocument): Promise<void> {
    await this.busSeats().replaceOne({ _id: seats._id }, seats, { upsert: true });
  }

  findSeats(routeId: string): Promise<BusSeatsDocument | null> {
    return this.loaderOf(routeId).get();
  }

  private loaderOf(routeId: string): CachedLoader<BusSeatsDocument | null> {
    const existing = this.loaders.get(routeId);
    if (existing) return existing;
    const loader = createCachedLoader({
      name: `bus_seats.${routeId}`,
      ttlMs: MEMORY_TTL_MS,
      load: () => this.busSeats().findOne({ _id: routeId }, { maxTimeMS: HOT_READ_MAX_TIME_MS }),
      // WHY: the memory bounds reads per replica rather than staleness, so CACHE=off keeps it.
      keepWhenCacheOff: true,
    });
    this.loaders.set(routeId, loader);
    return loader;
  }

  private busSeats(): Collection<BusSeatsDocument> {
    return mongoCollection<BusSeatsDocument>(config.mongo.dbName, COLLECTION);
  }
}
