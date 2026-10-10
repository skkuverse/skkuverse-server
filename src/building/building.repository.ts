import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../infra/config";
import { createCachedLoader } from "../infra/cached-loader";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../infra/mongo";
import { campusShapeDoc } from "./building.schema";
import type { BuildingDoc, CampusShapeDoc } from "./building.document";
import type { Campus } from "./building.types";

const CACHE_TTL_MS = 5 * 60 * 1000;

/** How long a failed reload keeps serving the last good campus shapes. */
const CAMPUS_SHAPES_STALE_WINDOW_MS = 60 * 60 * 1000;

// Every reload parses the same documents, so a bad one is reported once an
// hour per distinct set, not every five minutes.
const INVALID_SHAPES_LOG_INTERVAL_MS = 60 * 60 * 1000;

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

/** The shapes that parse, and an `id: paths` line for each one that does not (ADR 0010, D2). */
function partitionCampusShapes(docs: readonly unknown[]): { shapes: CampusShapeDoc[]; invalid: string[] } {
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
  return { shapes, invalid };
}

/**
 * The building module's shared reads: the building list and the campus shapes,
 * both cached, which catalog, search and the map module read and the sync
 * clears. A flow's own queries are its own repository's: catalog's,
 * search's and the sync's.
 */
@Injectable()
export class BuildingRepository implements OnModuleInit {
  private readonly invalidShapesThrottle = createLogThrottle(INVALID_SHAPES_LOG_INTERVAL_MS);

  // Every /building/* request and the campus overlay route read this list, so
  // it is cached, and concurrent misses share one scan. No stale window: a
  // failed read still reaches the caller, which is what marks the overlay
  // degraded.
  private readonly buildingsCache = createCachedLoader({
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
    staleWindowMs: CAMPUS_SHAPES_STALE_WINDOW_MS,
    load: async () => {
      const { shapes, invalid } = partitionCampusShapes(
        await this.campusShapes()
          .find({}, { projection: CAMPUS_SHAPE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
          .sort({ order: 1, _id: 1 })
          .toArray(),
      );
      this.warnInvalidShapes(invalid);
      return shapes;
    },
  });

  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("building", () => this.ensureIndexes());
  }

  /**
   * The indexes of the campus shapes, the root's only indexed reads. A flow's
   * own indexes sit with its queries: catalog's in BuildingCatalogRepository,
   * the sync's in BuildingSyncRepository; search has deliberately none
   * (BuildingSearchRepository).
   */
  async ensureIndexes(): Promise<void> {
    const campusShapes = this.campusShapes();

    await Promise.all([
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

  async listBuildings(campus?: Campus | null): Promise<readonly BuildingDoc[]> {
    const buildings = await this.buildingsCache.get();
    if (!campus) return buildings;
    return buildings.filter((b) => b.campus === campus);
  }

  /** Every campus shape, in authored order. */
  listCampusShapes(): Promise<readonly CampusShapeDoc[]> {
    return this.campusShapesCache.get();
  }

  /** Drops both caches; the building sync calls it after a run. */
  clearCache(): void {
    this.buildingsCache.clear();
    this.campusShapesCache.clear();
  }

  /** Left-out shapes are logged once per interval per distinct set. */
  private warnInvalidShapes(invalid: readonly string[]): void {
    const ticket = invalid.length > 0 ? this.invalidShapesThrottle.take(invalid.join("|")) : null;
    if (!ticket) return;
    logger.warn(
      { event: "building.campus_shapes.invalid", count: invalid.length, invalid, suppressed: ticket.suppressed },
      "Campus shapes left out: they do not match the document schema",
    );
  }

  private buildings(): Collection<BuildingDoc> {
    return mongoCollection<BuildingDoc>(config.building.dbName, config.building.collections.buildings);
  }

  private campusShapes(): Collection<CampusShapeDoc> {
    return mongoCollection<CampusShapeDoc>(config.building.dbName, config.building.collections.campusShapes);
  }
}
