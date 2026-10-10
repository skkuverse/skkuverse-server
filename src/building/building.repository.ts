import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../infra/config";
import { createCachedLoader } from "../infra/cached-loader";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../infra/mongo";
import { campusShapeDoc } from "./building.schema";
import type { BuildingDoc, CampusShapeDoc, ConnectionDoc, SpaceDoc } from "./building.document";
import type { Campus } from "./building.types";

const CACHE_TTL_MS = 5 * 60 * 1000;

const CAMPUS_SHAPE_FIELDS = {
  _id: 1,
  campus: 1,
  layerId: 1,
  geometry: 1,
  title: 1,
  subtitle: 1,
  skkuId: 1,
  order: 1,
} as const;

// Every reload parses the same documents, so a bad one is reported once an
// hour per distinct set, not every five minutes.
const invalidShapesThrottle = createLogThrottle(60 * 60_000);

/** The shapes that parse; the others are left out and logged (ADR 0010, D2). */
function toValidShapes(docs: readonly unknown[]): CampusShapeDoc[] {
  const shapes: CampusShapeDoc[] = [];
  const invalid: string[] = [];
  for (const doc of docs) {
    const parsed = campusShapeDoc.safeParse(doc);
    if (parsed.success) {
      shapes.push(parsed.data);
    } else {
      const id = (doc as { _id?: unknown })._id;
      const paths = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
      invalid.push(`${String(id)}: ${[...new Set(paths)].join(", ")}`);
    }
  }
  const ticket = invalid.length > 0 ? invalidShapesThrottle.take(invalid.join("|")) : null;
  if (ticket) {
    logger.warn(
      { event: "building.campus_shapes.invalid", count: invalid.length, invalid, suppressed: ticket.suppressed },
      "Campus shapes left out: they do not match the document schema",
    );
  }
  return shapes;
}

/**
 * Reads of the building DB: the building list (cached), one building, its
 * floors and connections, and the campus shapes (cached). Search is
 * BuildingSearchRepository's; writes are BuildingSyncRepository's.
 */
@Injectable()
export class BuildingRepository implements OnModuleInit {
  // Every /building/* request and the campus overlay route read this list, so
  // it is cached, and concurrent misses share one scan. No stale window: a
  // failed read still reaches the caller, which is what marks the overlay
  // degraded.
  private readonly allBuildings = createCachedLoader({
    name: "all buildings",
    ttlMs: CACHE_TTL_MS,
    load: () =>
      this.buildings()
        .find(
          {},
          {
            projection: { extensions: 0, sync: 0, enrichVersion: 0 },
            maxTimeMS: HOT_READ_MAX_TIME_MS,
          },
        )
        .sort({ _id: 1 })
        .toArray(),
  });

  /**
   * Cached like the building list. The overlay route's 24-hour `Cache-Control`
   * only helps a client that keeps an HTTP cache, and not every client does, so
   * the database would otherwise see one read per map open. A correction reaches
   * the route within one TTL, which is small next to that 24-hour client TTL. A
   * failed reload serves the last good shapes for up to an hour, with a warning.
   * Without that, the overlay route would drop the shapes from a response it
   * still marks cacheable for a day (a shapes failure is not `degraded`), and the
   * shapes change only a few times a year.
   */
  private readonly campusShapesCache = createCachedLoader({
    name: "campus shapes",
    ttlMs: CACHE_TTL_MS,
    staleWindowMs: 60 * 60 * 1000,
    load: async () =>
      toValidShapes(
        await this.campusShapes()
          .find({}, { projection: CAMPUS_SHAPE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
          .sort({ order: 1, _id: 1 })
          .toArray(),
      ),
  });

  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("building", () => this.ensureIndexes());
  }

  /**
   * The indexes of the building reads: /building/list and listFloorsByBuildNo,
   * connections and campus shapes. Search has deliberately none
   * (BuildingSearchRepository); the sync's own are BuildingSyncRepository's.
   */
  async ensureIndexes(): Promise<void> {
    const buildings = this.buildings();
    const spaces = this.spaces();
    const connections = this.connections();
    const campusShapes = this.campusShapes();

    await Promise.all([
      // buildings (enriched)
      buildings.createIndex({ campus: 1 }),
      buildings.createIndex({ buildNo: 1, campus: 1 }),
      buildings.createIndex({ location: "2dsphere" }),
      // spaces (the unique key the sync upserts on is BuildingSyncRepository's)
      spaces.createIndex({ buildNo: 1 }),
      spaces.createIndex({ campus: 1 }),
      // connections
      connections.createIndex({ "a.skkuId": 1 }),
      connections.createIndex({ "b.skkuId": 1 }),
      // campus_shapes. The 2dsphere is not for geo queries — none are run — it
      // is there because Mongo rejects a malformed ring at insert, which is the
      // cheapest guard we get against geometry that would fail to draw. Same
      // reasoning as the places collection.
      //
      // The other one covers the ONE read there is, the campus shapes loader's
      // `find({}).sort({order: 1, _id: 1})`. Not `{campus: 1}`: nothing filters
      // by campus, and an index on a field no query names is a write cost with
      // no reader.
      campusShapes.createIndex({ order: 1, _id: 1 }),
      campusShapes.createIndex({ geometry: "2dsphere" }),
    ]);
  }

  async listBuildings(campus?: Campus | null): Promise<BuildingDoc[]> {
    const buildings = await this.allBuildings.get();
    if (!campus) return buildings;
    return buildings.filter((b) => b.campus === campus);
  }

  /** Every campus shape, in authored order. */
  listCampusShapes(): Promise<CampusShapeDoc[]> {
    return this.campusShapesCache.get();
  }

  /** Drops both caches; the building sync calls it after a run. */
  clearCache(): void {
    this.allBuildings.clear();
    this.campusShapesCache.clear();
  }

  private buildings(): Collection<BuildingDoc> {
    return mongoCollection<BuildingDoc>(config.building.dbName!, config.building.collections.buildings);
  }

  private spaces(): Collection<SpaceDoc> {
    return mongoCollection<SpaceDoc>(config.building.dbName!, config.building.collections.spaces);
  }

  private connections(): Collection<ConnectionDoc> {
    return mongoCollection<ConnectionDoc>(config.building.dbName!, config.building.collections.connections);
  }

  private campusShapes(): Collection<CampusShapeDoc> {
    return mongoCollection<CampusShapeDoc>(config.building.dbName!, config.building.collections.campusShapes);
  }
}
