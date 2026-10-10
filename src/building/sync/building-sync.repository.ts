import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { AnyBulkWriteOperation, BulkWriteResult, Collection } from "mongodb";
import config from "../../infra/config";
import logger from "../../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import type {
  BuildingAttachment,
  BuildingDoc,
  BuildingRawDoc,
  SpaceDoc,
} from "../building.document";
import type { EnrichedBuilding, ListedBuilding, SpaceSource, SyncedSpace } from "./building-sync.types";
import type { SkkuId } from "../building.types";

/**
 * The sync runs weekly, off the request path: a stuck read fails the run
 * instead of hanging it, and the bound is generous enough that a slow cluster
 * does not.
 */
const SYNC_READ_MAX_TIME_MS = 30_000;

/**
 * An enriched building as a `$set` of dot paths: "name.ko" updates that one
 * field, where a whole-object `$set` would drop its siblings.
 */
function toEnrichedSet(building: EnrichedBuilding): Record<string, unknown> {
  return {
    buildNo: building.buildNo,
    displayNo: building.displayNo,
    type: building.type,
    campus: building.campus,
    "name.ko": building.name.ko,
    "name.en": building.name.en,
    "description.ko": building.description.ko,
    "description.en": building.description.en,
    location: building.location,
    image: building.image,
    attachments: building.attachments,
    "accessibility.elevator": building.accessibility.elevator,
    "accessibility.toilet": building.accessibility.toilet,
    "accessibility.detail": building.accessibility.detail,
    enrichVersion: building.enrichVersion,
    skkuCreatedAt: building.skkuCreatedAt,
    skkuUpdatedAt: building.skkuUpdatedAt,
  };
}

/**
 * The upsert for one space reported by either listing. Both write the same
 * names; spaceList also owns `conspaceCd`, which a buildInfo insert starts as
 * null. `sources` accumulates which listings reported the space.
 */
function toSpaceUpsert(
  space: SyncedSpace,
  source: SpaceSource,
  syncStartedAt: Date,
): AnyBulkWriteOperation<SpaceDoc> {
  const filter = { spaceCd: space.spaceCd, buildNo: space.buildNo, campus: space.campus };
  const names = { floor: space.floor, name: space.name, buildingName: space.buildingName };
  if (source === "buildInfo") {
    return {
      updateOne: {
        filter,
        update: {
          $set: { ...names, syncedAt: syncStartedAt },
          $addToSet: { sources: source },
          $setOnInsert: { conspaceCd: null },
        },
        upsert: true,
      },
    };
  }
  return {
    updateOne: {
      filter,
      update: {
        $set: { ...names, conspaceCd: space.conspaceCd, syncedAt: syncStartedAt },
        $addToSet: { sources: source },
      },
      upsert: true,
    },
  };
}

/**
 * The building sync's reads and writes: the raw layer (buildings_raw), the
 * enriched layer (buildings) and the spaces. Every write is an upsert keyed by
 * SKKU's own ids, so a rerun converges.
 */
@Injectable()
export class BuildingSyncRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("building.sync", () => this.ensureIndexes());
  }

  /**
   * The indexes the sync's writes need: the unique key its space upserts
   * filter on (it also keeps a listing from duplicating a room), and the raw
   * layer's campus.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.raw().createIndex({ campus: 1 }),
      this.spaces().createIndex({ spaceCd: 1, buildNo: 1, campus: 1 }, { unique: true }),
    ]);
  }

  /** skkuUpdatedAt of every raw building, for change detection. */
  async listRawUpdatedAt(): Promise<Map<SkkuId, string | null>> {
    const rawBuildings = await this.raw()
      .find({}, { projection: { skkuUpdatedAt: 1 }, maxTimeMS: SYNC_READ_MAX_TIME_MS })
      .toArray();
    return new Map(rawBuildings.map((d) => [d._id, d.skkuUpdatedAt]));
  }

  /** Enriched buildings whose enrichVersion is not `version`. */
  async listSkkuIdsNotEnrichedAt(version: number): Promise<Set<SkkuId>> {
    const staleBuildings = await this.enriched()
      .find(
        { enrichVersion: { $ne: version } },
        { projection: { _id: 1 }, maxTimeMS: SYNC_READ_MAX_TIME_MS },
      )
      .toArray();
    return new Set(staleBuildings.map((d) => d._id));
  }

  upsertRaw(listed: readonly ListedBuilding[], syncStartedAt: Date): Promise<BulkWriteResult> {
    const ops: AnyBulkWriteOperation<BuildingRawDoc>[] = listed.map(({ skkuId, doc }) => ({
      updateOne: {
        filter: { _id: skkuId },
        update: { $set: { ...doc, "sync.listAt": syncStartedAt } },
        upsert: true,
      },
    }));
    return this.raw().bulkWrite(ops, { ordered: false });
  }

  listRawBySkkuIds(skkuIds: Iterable<SkkuId>): Promise<BuildingRawDoc[]> {
    return this.raw()
      .find({ _id: { $in: [...skkuIds] } }, { maxTimeMS: SYNC_READ_MAX_TIME_MS })
      .toArray();
  }

  upsertEnriched(
    entries: ReadonlyArray<{ skkuId: SkkuId; building: EnrichedBuilding }>,
    syncStartedAt: Date,
  ): Promise<BulkWriteResult> {
    const ops: AnyBulkWriteOperation<BuildingDoc>[] = entries.map(({ skkuId, building }) => ({
      updateOne: {
        filter: { _id: skkuId },
        update: {
          $set: { ...toEnrichedSet(building), "sync.listAt": syncStartedAt, updatedAt: syncStartedAt },
          $setOnInsert: { extensions: {} },
        },
        upsert: true,
      },
    }));
    return this.enriched().bulkWrite(ops, { ordered: false });
  }

  /** Writes a building's photos to BOTH layers and clears its detail error. */
  async setAttachments(
    skkuId: SkkuId,
    attachments: BuildingAttachment[],
    syncStartedAt: Date,
  ): Promise<void> {
    const update = {
      $set: { attachments, "sync.detailAt": syncStartedAt, "sync.detailError": null },
    };
    await Promise.all([
      this.raw().updateOne({ _id: skkuId }, update),
      this.enriched().updateOne({ _id: skkuId }, update),
    ]);
  }

  /** Notes a failed buildInfo on both layers. Best effort: a failed note is logged, never thrown. */
  async recordDetailError(skkuId: SkkuId, message: string): Promise<void> {
    const update = { $set: { "sync.detailError": message } };
    const noteFailed = (err: unknown): void =>
      logger.warn(
        { event: "building.sync.error_note_failed", skkuId, err },
        "Could not record the buildInfo failure on the building",
      );
    await Promise.all([
      this.raw().updateOne({ _id: skkuId }, update).catch(noteFailed),
      this.enriched().updateOne({ _id: skkuId }, update).catch(noteFailed),
    ]);
  }

  upsertSpaces(
    spaces: readonly SyncedSpace[],
    source: SpaceSource,
    syncStartedAt: Date,
  ): Promise<BulkWriteResult> {
    return this.spaces().bulkWrite(
      spaces.map((space) => toSpaceUpsert(space, source, syncStartedAt)),
      { ordered: false },
    );
  }

  /** Deletes the spaces this run did not see; returns how many. */
  async deleteSpacesSyncedBefore(syncStartedAt: Date): Promise<number> {
    const deleteResult = await this.spaces().deleteMany({ syncedAt: { $lt: syncStartedAt } });
    return deleteResult.deletedCount;
  }

  private raw(): Collection<BuildingRawDoc> {
    return mongoCollection<BuildingRawDoc>(config.building.dbName!, config.building.collections.buildingsRaw);
  }

  private enriched(): Collection<BuildingDoc> {
    return mongoCollection<BuildingDoc>(config.building.dbName!, config.building.collections.buildings);
  }

  private spaces(): Collection<SpaceDoc> {
    return mongoCollection<SpaceDoc>(config.building.dbName!, config.building.collections.spaces);
  }
}
