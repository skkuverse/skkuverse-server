import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../infra/config";
import { createCachedLoader } from "../infra/cached-loader";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../infra/mongo";
import { BUILDING_CACHE_TTL_MS } from "./building.rules";
import { campusShapeDoc } from "./building.schema";
import type { BuildingDoc, CampusShapeDoc } from "./building.document";
import type { Campus } from "./building.types";

const CAMPUS_SHAPES_TTL_MS = 5 * 60 * 1000;

const CAMPUS_SHAPES_STALE_WINDOW_MS = 60 * 60 * 1000;

// Every reload re-parses the same documents, so a bad set is reported hourly, not every TTL.
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

@Injectable()
export class BuildingRepository implements OnModuleInit {
  private readonly invalidShapesThrottle = createLogThrottle(INVALID_SHAPES_LOG_INTERVAL_MS);

  // No stale window: a failed read must reach the map's campus overlay, which then
  // marks itself degraded and is not cached.
  private readonly buildingsCache = createCachedLoader({
    name: "all buildings",
    ttlMs: BUILDING_CACHE_TTL_MS,
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

  // The overlay's 24 h Cache-Control helps only clients with an HTTP cache. A failed
  // reload serves the last good shapes: a shapes failure does not mark the overlay
  // degraded, so it would serve the empty set as cacheable for a day.
  private readonly campusShapesCache = createCachedLoader({
    name: "campus shapes",
    ttlMs: CAMPUS_SHAPES_TTL_MS,
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

  async ensureIndexes(): Promise<void> {
    const campusShapes = this.campusShapes();

    await Promise.all([
      campusShapes.createIndex({ order: 1, _id: 1 }),
      // No geo query runs: the 2dsphere makes Mongo reject a malformed ring at insert.
      campusShapes.createIndex({ geometry: "2dsphere" }),
    ]);
  }

  async listBuildings(campus?: Campus | null): Promise<readonly BuildingDoc[]> {
    const buildings = await this.buildingsCache.get();
    if (!campus) return buildings;
    return buildings.filter((b) => b.campus === campus);
  }

  listCampusShapes(): Promise<readonly CampusShapeDoc[]> {
    return this.campusShapesCache.get();
  }

  clearCache(): void {
    this.buildingsCache.clear();
    this.campusShapesCache.clear();
  }

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
