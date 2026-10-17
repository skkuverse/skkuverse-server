import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import { parseEach } from "../../shared/zod-list.util";
import type { BuildingDoc, ConnectionDoc, SpaceDoc } from "../building.document";
import type { CafeteriaDoc } from "../cafeteria/building-cafeteria.document";
import { SERVED_BUILDING_PROJECTION } from "../building.query";
import type { BuildNo, SkkuId } from "../building.types";
import type { BuildingLabel, CafeteriaSummary, ConnectionEnds, FloorSpaceDoc } from "./building-catalog.document";
import { connectionEnds } from "./building-catalog.schema";

// WHY: read on every detail request, so a bad connection is reported hourly, not per request.
const INVALID_CONNECTIONS_LOG_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class BuildingCatalogRepository implements OnModuleInit {
  private readonly invalidConnectionsThrottle = createLogThrottle(INVALID_CONNECTIONS_LOG_INTERVAL_MS);

  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("building.catalog", () => this.ensureIndexes());
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.spaces().createIndex({ buildNo: 1 }),
      this.connections().createIndex({ "a.skkuId": 1 }),
      this.connections().createIndex({ "b.skkuId": 1 }),
      this.facilities().createIndex({ buildNo: 1 }),
    ]);
  }

  findBuildingBySkkuId(skkuId: SkkuId): Promise<BuildingDoc | null> {
    return this.buildings().findOne(
      { _id: skkuId },
      { projection: SERVED_BUILDING_PROJECTION, maxTimeMS: HOT_READ_MAX_TIME_MS },
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

  async listConnectionsBySkkuId(skkuId: SkkuId): Promise<ConnectionEnds[]> {
    const { valid: connections, invalid } = parseEach(
      await this.connections()
        .find(
          { $or: [{ "a.skkuId": skkuId }, { "b.skkuId": skkuId }] },
          { projection: { _id: 0, a: 1, b: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
        )
        .toArray(),
      connectionEnds,
      (_doc, index) => `#${index}`,
    );
    this.warnInvalidConnections(skkuId, invalid);
    return connections;
  }

  listCafeteriasByBuildNo(buildNo: BuildNo): Promise<CafeteriaSummary[]> {
    return this.facilities()
      .find(
        { buildNo, kind: "cafeteria" },
        { projection: { _id: 1, name: 1, floor: 1, spaceCd: 1 }, sort: { _id: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
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

  private warnInvalidConnections(skkuId: SkkuId, invalid: readonly string[]): void {
    const ticket = invalid.length > 0 ? this.invalidConnectionsThrottle.take(`${skkuId}:${invalid.join("|")}`) : null;
    if (!ticket) return;
    logger.warn(
      { event: "building.connections.invalid", skkuId, count: invalid.length, invalid, suppressed: ticket.suppressed },
      "Connections left out: they do not match the document schema",
    );
  }

  private buildings(): Collection<BuildingDoc> {
    return mongoCollection<BuildingDoc>(config.building.dbName, config.building.collections.buildings);
  }

  private spaces(): Collection<SpaceDoc> {
    return mongoCollection<SpaceDoc>(config.building.dbName, config.building.collections.spaces);
  }

  private facilities(): Collection<CafeteriaDoc> {
    return mongoCollection<CafeteriaDoc>(config.building.dbName, config.building.collections.facilities);
  }

  private connections(): Collection<ConnectionDoc> {
    return mongoCollection<ConnectionDoc>(config.building.dbName, config.building.collections.connections);
  }
}
