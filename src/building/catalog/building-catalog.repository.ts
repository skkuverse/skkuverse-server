import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import { isRecord } from "../../shared/object.util";
import { issuePaths, parseEach } from "../../shared/zod-list.util";
import type { BuildingDoc, CafeteriaDoc, ConnectionDoc, SpaceDoc } from "../building.document";
import { SERVED_BUILDING_FIELDS } from "../building.query";
import { buildingDoc } from "../building.schema";
import type { BuildNo, SkkuId } from "../building.types";
import type { BuildingLabel, CafeteriaSummary, ConnectionEnds, FloorSpaceDoc } from "./building-catalog.document";
import { buildingLabel, cafeteriaSummary, connectionEnds, floorSpace } from "./building-catalog.schema";

// WHY: read on every detail request, so a bad document is reported hourly, not per request.
const INVALID_DOCUMENTS_LOG_INTERVAL_MS = 60 * 60 * 1000;

const FLOOR_SPACE_FIELDS = { _id: 0, spaceCd: 1, name: 1, floor: 1, conspaceCd: 1 } as const;

const BUILDING_LABEL_FIELDS = { _id: 1, buildNo: 1, campus: 1, name: 1 } as const;

const CAFETERIA_SUMMARY_FIELDS = { _id: 1, name: 1, floor: 1, spaceCd: 1 } as const;

type InvalidEvent = `building.${"buildings" | "spaces" | "connections" | "cafeterias"}.invalid`;

type InvalidScope = { skkuId: SkkuId } | { buildNo: BuildNo } | { skkuIds: readonly SkkuId[] };

@Injectable()
export class BuildingCatalogRepository implements OnModuleInit {
  private readonly invalidDocumentsThrottle = createLogThrottle(INVALID_DOCUMENTS_LOG_INTERVAL_MS);

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

  async findBuildingBySkkuId(skkuId: SkkuId): Promise<BuildingDoc | null> {
    const building = await this.buildings().findOne(
      { _id: skkuId },
      { projection: SERVED_BUILDING_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
    if (building === null) return null;
    const parsed = buildingDoc.safeParse(building);
    if (parsed.success) return parsed.data;
    this.warnInvalid("building.buildings.invalid", { skkuId }, [`${skkuId}: ${issuePaths(parsed.error)}`]);
    return null;
  }

  async listSpacesByBuildNo(buildNo: BuildNo): Promise<FloorSpaceDoc[]> {
    const { valid: spaces, invalid } = parseEach(
      await this.spaces().find({ buildNo }, { projection: FLOOR_SPACE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS }).toArray(),
      floorSpace,
      (doc, index) => (isRecord(doc) && typeof doc.spaceCd === "string" ? doc.spaceCd : `#${index}`),
    );
    this.warnInvalid("building.spaces.invalid", { buildNo }, invalid);
    return spaces;
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
    this.warnInvalid("building.connections.invalid", { skkuId }, invalid);
    return connections;
  }

  async listCafeteriasByBuildNo(buildNo: BuildNo): Promise<CafeteriaSummary[]> {
    const { valid: cafeterias, invalid } = parseEach(
      await this.facilities()
        .find(
          { buildNo, kind: "cafeteria" },
          { projection: CAFETERIA_SUMMARY_FIELDS, sort: { _id: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
        )
        .toArray(),
      cafeteriaSummary,
      (doc, index) => (isRecord(doc) ? String(doc._id) : `#${index}`),
    );
    this.warnInvalid("building.cafeterias.invalid", { buildNo }, invalid);
    return cafeterias;
  }

  async listBuildingsBySkkuIds(skkuIds: readonly SkkuId[]): Promise<BuildingLabel[]> {
    const { valid: labels, invalid } = parseEach(
      await this.buildings()
        .find({ _id: { $in: [...skkuIds] } }, { projection: BUILDING_LABEL_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
        .toArray(),
      buildingLabel,
      (doc, index) => (isRecord(doc) ? String(doc._id) : `#${index}`),
    );
    this.warnInvalid("building.buildings.invalid", { skkuIds }, invalid);
    return labels;
  }

  private warnInvalid(event: InvalidEvent, scope: InvalidScope, invalid: readonly string[]): void {
    const key = `${event}:${Object.values(scope).join(",")}:${invalid.join("|")}`;
    const ticket = invalid.length > 0 ? this.invalidDocumentsThrottle.take(key) : null;
    if (!ticket) return;
    logger.warn(
      { event, ...scope, count: invalid.length, invalid, suppressed: ticket.suppressed },
      "Documents left out: they do not match the document schema",
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
