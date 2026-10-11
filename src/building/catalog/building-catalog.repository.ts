import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import type { BuildingDoc, ConnectionDoc, SpaceDoc } from "../building.document";
import { SERVED_BUILDING_WITH_EXTENSIONS_PROJECTION } from "../building.query";
import type { BuildNo, SkkuId } from "../building.types";
import type { BuildingLabel, ConnectionEnds, FloorSpaceDoc } from "./building-catalog.document";

@Injectable()
export class BuildingCatalogRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("building.catalog", () => this.ensureIndexes());
  }

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
      { projection: SERVED_BUILDING_WITH_EXTENSIONS_PROJECTION, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
  }

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

  listConnectionsBySkkuId(skkuId: SkkuId): Promise<ConnectionEnds[]> {
    return this.connections()
      .find(
        { $or: [{ "a.skkuId": skkuId }, { "b.skkuId": skkuId }] },
        { projection: { _id: 0, a: 1, b: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
      )
      .toArray();
  }

  listBuildingsBySkkuIds(skkuIds: readonly SkkuId[]): Promise<BuildingLabel[]> {
    return this.buildings()
      .find(
        { _id: { $in: [...skkuIds] } },
        { projection: { _id: 1, buildNo: 1, displayNo: 1, name: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
      )
      .toArray();
  }

  private buildings(): Collection<BuildingDoc> {
    return mongoCollection<BuildingDoc>(config.building.dbName, config.building.collections.buildings);
  }

  private spaces(): Collection<SpaceDoc> {
    return mongoCollection<SpaceDoc>(config.building.dbName, config.building.collections.spaces);
  }

  private connections(): Collection<ConnectionDoc> {
    return mongoCollection<ConnectionDoc>(config.building.dbName, config.building.collections.connections);
  }
}
