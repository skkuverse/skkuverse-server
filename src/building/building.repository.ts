import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../infra/config";
import { createCachedLoader } from "../infra/cached-loader";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../infra/mongo";
import { isRecord } from "../shared/object.util";
import { parseEach } from "../shared/zod-list.util";
import { SERVED_BUILDING_PROJECTION } from "./building.query";
import { BUILDING_CACHE_TTL_MS } from "./building.constants";
import { campusShapeDoc } from "./building.schema";
import type { BuildingDoc, CampusShapeDoc } from "./building.document";
import type { Campus } from "./building.types";

const CAMPUS_SHAPES_TTL_MS = 5 * 60 * 1000;

const CAMPUS_SHAPES_STALE_WINDOW_MS = 60 * 60 * 1000;

// WHY: every reload re-parses the same documents, so a bad set is reported hourly, not every TTL.
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

@Injectable()
export class BuildingRepository implements OnModuleInit {
  private readonly invalidShapesThrottle = createLogThrottle(INVALID_SHAPES_LOG_INTERVAL_MS);

  // WHY: no stale window: a failed read must reach the map's campus overlay, which then
  // marks itself degraded and is not cached.
  private readonly buildingsCache = createCachedLoader({
    name: "all buildings",
    ttlMs: BUILDING_CACHE_TTL_MS,
    load: () =>
      this.buildings()
        .find(
          {},
          {
            projection: SERVED_BUILDING_PROJECTION,
            maxTimeMS: HOT_READ_MAX_TIME_MS,
          },
        )
        .sort({ _id: 1 })
        .toArray(),
  });

  // WHY: a failed reload serves the last good shapes: a shapes failure does not mark the
  // overlay degraded, so an empty set would go out with its 24 h Cache-Control.
  private readonly campusShapesCache = createCachedLoader({
    name: "campus shapes",
    ttlMs: CAMPUS_SHAPES_TTL_MS,
    staleWindowMs: CAMPUS_SHAPES_STALE_WINDOW_MS,
    load: async () => {
      const { valid: shapes, invalid } = parseEach(
        await this.campusShapes()
          .find({}, { projection: CAMPUS_SHAPE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
          .sort({ order: 1, _id: 1 })
          .toArray(),
        campusShapeDoc,
        (doc) => String(isRecord(doc) ? doc._id : undefined),
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
      // WHY: no geo query runs; the 2dsphere index makes Mongo reject a malformed ring at insert.
      campusShapes.createIndex({ geometry: "2dsphere" }),
    ]);
  }

  async listBuildings(campus?: Campus): Promise<readonly BuildingDoc[]> {
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
