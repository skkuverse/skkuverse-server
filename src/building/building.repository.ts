import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection, Document } from "mongodb";
import config from "../infra/config";
import { createCachedLoader } from "../infra/cached-loader";
import { getClient, HOT_READ_MAX_TIME_MS } from "../infra/db";
import logger from "../infra/logger";
import {
  buildingSearchPipeline,
  spaceSearchPipeline,
  toRankedResult,
  type RankedFacet,
  type RankedSearchResult,
} from "./building-search.rules";
import type {
  BuildingDoc,
  BuildingRawDoc,
  CampusShapeDoc,
  ConnectionDoc,
  SpaceDoc,
} from "./building.document";
import { groupByFloor, toConnectionItems } from "./building.mapper";
import type { Campus, ConnectionResponseItem, FloorGroup } from "./building.types";

const CACHE_TTL_MS = 5 * 60 * 1000;

/** A collection of the building DB. Its name is required config, so it is set. */
function collection<T extends Document>(name: string): Collection<T> {
  return getClient().db(config.building.dbName!).collection<T>(name);
}

/**
 * Reads of the building DB: the building list (cached), one building, its
 * floors and connections, ranked search, and the campus shapes (cached). Owns
 * the DB's indexes. Writes belong to BuildingSyncRepository.
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
    load: () =>
      this.campusShapes()
        .find({}, { maxTimeMS: HOT_READ_MAX_TIME_MS })
        .sort({ order: 1, _id: 1 })
        .toArray(),
  });

  /** Index setup never fails the boot: it warns and the next boot retries. */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureIndexes();
      logger.info({ event: "building.indexes.ensured" }, "Indexes ensured");
    } catch (err) {
      logger.warn({ event: "building.indexes.failed", err }, "Index setup failed");
    }
  }

  /**
   * NOTE ON SEARCH: there is deliberately no index here for /building/search,
   * and adding one would be cost without effect. A $or uses index-union only if
   * EVERY branch is indexed; the search predicate ORs over name.ko / name.en /
   * buildingName.* which are not, so the whole thing plans as SUBPLAN ->
   * COLLSCAN and the spaceCd branch never gets its own IXSCAN. $options:"i"
   * would disable prefix-anchoring anyway. Measured: ~20ms over 7691 spaces,
   * and the endpoint went from six collection scans to two when rows and counts
   * merged into one $facet. spaces is ~2.5MB and fully cached.
   *
   * If spaces ever grows ~10x, the fix is Atlas Search (autocomplete/edgeGram
   * mapping on spaceCd), not a classic index. Watch the $facet ceiling too: each
   * facet stage is capped at 100MB and CANNOT spill to disk (allowDiskUse does
   * not apply), and the emitted document is bound by the 16MB BSON limit.
   *
   * The indexes below serve /building/list, getFloorsByBuildNo and the sync
   * upserts — keep them.
   */
  async ensureIndexes(): Promise<void> {
    const buildings = this.buildings();
    const buildingsRaw = collection<BuildingRawDoc>(config.building.collections.buildingsRaw);
    const spaces = this.spaces();
    const connections = this.connections();
    const campusShapes = this.campusShapes();

    await Promise.all([
      // buildings (enriched)
      buildings.createIndex({ campus: 1 }),
      buildings.createIndex({ buildNo: 1, campus: 1 }),
      buildings.createIndex({ location: "2dsphere" }),
      // buildings_raw
      buildingsRaw.createIndex({ campus: 1 }),
      // spaces
      spaces.createIndex({ spaceCd: 1, buildNo: 1, campus: 1 }, { unique: true }),
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

  async getAllBuildings(campus?: Campus | null): Promise<BuildingDoc[]> {
    const docs = await this.allBuildings.get();
    if (!campus) return docs;
    return docs.filter((b) => b.campus === campus);
  }

  getBuildingBySkkuId(skkuId: number): Promise<BuildingDoc | null> {
    return this.buildings().findOne(
      { _id: skkuId },
      { projection: { sync: 0, enrichVersion: 0 } },
    );
  }

  async getFloorsByBuildNo(buildNo: string | null): Promise<FloorGroup[]> {
    if (!buildNo) return [];
    const spaces = await this.spaces()
      .find(
        { buildNo },
        { projection: { _id: 0, spaceCd: 1, name: 1, floor: 1, conspaceCd: 1 } },
      )
      .toArray();
    return groupByFloor(spaces);
  }

  async getConnectionsForBuilding(skkuId: number): Promise<ConnectionResponseItem[]> {
    const docs = await this.connections()
      .find({ $or: [{ "a.skkuId": skkuId }, { "b.skkuId": skkuId }] })
      .toArray();
    if (!docs.length) return [];

    const relatedIds = new Set<number>();
    for (const doc of docs) {
      relatedIds.add(doc.a.skkuId);
      relatedIds.add(doc.b.skkuId);
    }
    relatedIds.delete(skkuId);

    const targets = await this.buildings()
      .find(
        { _id: { $in: Array.from(relatedIds) } },
        { projection: { _id: 1, buildNo: 1, displayNo: 1, name: 1 } },
      )
      .toArray();
    return toConnectionItems(skkuId, docs, targets);
  }

  /**
   * Ranked search. Rows and per-campus counts arrive together from one $facet,
   * so the count can never describe a different predicate than the list.
   */
  async searchBuildings(
    query: string,
    campus?: Campus | null,
  ): Promise<RankedSearchResult<BuildingDoc>> {
    const facets = await this.buildings()
      .aggregate<RankedFacet<BuildingDoc>>(buildingSearchPipeline(query, campus), {
        maxTimeMS: 5000,
      })
      .toArray();
    return toRankedResult(facets);
  }

  async searchSpaces(
    query: string,
    campus?: Campus | null,
  ): Promise<RankedSearchResult<SpaceDoc>> {
    const facets = await this.spaces()
      .aggregate<RankedFacet<SpaceDoc>>(spaceSearchPipeline(query, campus), {
        maxTimeMS: 5000,
      })
      .toArray();
    return toRankedResult(facets);
  }

  /** Every campus shape, in authored order. */
  getAllCampusShapes(): Promise<CampusShapeDoc[]> {
    return this.campusShapesCache.get();
  }

  /** Drops both caches; the building sync calls it after a run. */
  clearCache(): void {
    this.allBuildings.clear();
    this.campusShapesCache.clear();
  }

  private buildings(): Collection<BuildingDoc> {
    return collection<BuildingDoc>(config.building.collections.buildings);
  }

  private spaces(): Collection<SpaceDoc> {
    return collection<SpaceDoc>(config.building.collections.spaces);
  }

  private connections(): Collection<ConnectionDoc> {
    return collection<ConnectionDoc>(config.building.collections.connections);
  }

  private campusShapes(): Collection<CampusShapeDoc> {
    return collection<CampusShapeDoc>(config.building.collections.campusShapes);
  }
}
