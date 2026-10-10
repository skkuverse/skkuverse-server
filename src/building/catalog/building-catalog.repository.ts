import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import type {
  BuildingDoc,
  BuildingLabel,
  ConnectionDoc,
  ConnectionEnds,
  FloorSpaceDoc,
  SpaceDoc,
} from "../building.document";
import type { BuildNo, SkkuId } from "../building.types";

/**
 * The reads behind one building's page: the building, its spaces, its
 * connections and the buildings at their far ends. The cached building list
 * and the campus shapes are BuildingRepository's.
 */
@Injectable()
export class BuildingCatalogRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("building.catalog", () => this.ensureIndexes());
  }

  /** The indexes these reads use: a building's spaces, and a connection from either end. */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.spaces().createIndex({ buildNo: 1 }),
      this.connections().createIndex({ "a.skkuId": 1 }),
      this.connections().createIndex({ "b.skkuId": 1 }),
    ]);
  }

  findBuildingBySkkuId(skkuId: SkkuId): Promise<BuildingDoc | null> {
    return this.buildings().findOne(
      { _id: skkuId },
      { projection: { sync: 0, enrichVersion: 0 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
  }

  /** The spaces of one building, for its floor list. */
  listSpacesByBuildNo(buildNo: BuildNo): Promise<FloorSpaceDoc[]> {
    return this.spaces()
      .find(
        { buildNo },
        {
          projection: { _id: 0, spaceCd: 1, name: 1, floor: 1, conspaceCd: 1 },
          maxTimeMS: HOT_READ_MAX_TIME_MS,
        },
      )
      .toArray();
  }

  /** The connections that touch one building, from either side; only the two ends are read. */
  listConnectionsBySkkuId(skkuId: SkkuId): Promise<ConnectionEnds[]> {
    return this.connections()
      .find(
        { $or: [{ "a.skkuId": skkuId }, { "b.skkuId": skkuId }] },
        { projection: { _id: 0, a: 1, b: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
      )
      .toArray();
  }

  /** The numbers and names of the given buildings, to label the far side of a connection. */
  listBuildingsByIds(ids: readonly SkkuId[]): Promise<BuildingLabel[]> {
    return this.buildings()
      .find(
        { _id: { $in: [...ids] } },
        { projection: { _id: 1, buildNo: 1, displayNo: 1, name: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
      )
      .toArray();
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
}
