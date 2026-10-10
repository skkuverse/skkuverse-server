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
  SpaceSource,
} from "../building.document";
import type { EnrichedBuilding, ListedBuilding, SyncedSpace } from "./building-sync.types";
import type { SkkuId } from "../building.types";

/** Off the request path: a stuck read fails the weekly run instead of hanging it, with room for a slow cluster. */
const SYNC_READ_MAX_TIME_MS = 30_000;

/** Dot paths, because a whole-object $set would drop the fields it does not name (sync stamps, extensions). */
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

type SpaceUpsert = AnyBulkWriteOperation<SpaceDoc>;

const spaceKey = (space: SyncedSpace) => ({ spaceCd: space.spaceCd, buildNo: space.buildNo, campus: space.campus });

const spaceNames = (space: SyncedSpace) => ({ floor: space.floor, name: space.name, buildingName: space.buildingName });

/** An insert starts `conspaceCd` as null: only spaceList reports it. */
function toBuildInfoSpaceUpsert(space: SyncedSpace, syncStartedAt: Date): SpaceUpsert {
  return {
    updateOne: {
      filter: spaceKey(space),
      update: {
        $set: { ...spaceNames(space), syncedAt: syncStartedAt },
        $addToSet: { sources: "buildInfo" },
        $setOnInsert: { conspaceCd: null },
      },
      upsert: true,
    },
  };
}

function toSpaceListSpaceUpsert(space: SyncedSpace, syncStartedAt: Date): SpaceUpsert {
  return {
    updateOne: {
      filter: spaceKey(space),
      update: {
        $set: { ...spaceNames(space), conspaceCd: space.conspaceCd, syncedAt: syncStartedAt },
        $addToSet: { sources: "spaceList" },
      },
      upsert: true,
    },
  };
}

const SPACE_UPSERT_BY_SOURCE: Readonly<Record<SpaceSource, (space: SyncedSpace, syncStartedAt: Date) => SpaceUpsert>> = {
  buildInfo: toBuildInfoSpaceUpsert,
  spaceList: toSpaceListSpaceUpsert,
};

// Every write is an upsert keyed by SKKU's own ids, so a rerun converges.
@Injectable()
export class BuildingSyncRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("building.sync", () => this.ensureIndexes());
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.raw().createIndex({ campus: 1 }),
      // No geo query runs: the 2dsphere makes Mongo reject a malformed point at upsert.
      this.enriched().createIndex({ location: "2dsphere" }),
      // The space upserts filter on this key; unique, so a listing cannot duplicate a room.
      this.spaces().createIndex({ spaceCd: 1, buildNo: 1, campus: 1 }, { unique: true }),
    ]);
  }

  async listRawUpdatedAt(): Promise<Map<SkkuId, string | null>> {
    const rawBuildings = await this.raw()
      .find({}, { projection: { skkuUpdatedAt: 1 }, maxTimeMS: SYNC_READ_MAX_TIME_MS })
      .toArray();
    return new Map(rawBuildings.map((d) => [d._id, d.skkuUpdatedAt]));
  }

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

  /** Best effort: a note that fails to write is logged, never thrown. */
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
      spaces.map((space) => SPACE_UPSERT_BY_SOURCE[source](space, syncStartedAt)),
      { ordered: false },
    );
  }

  async deleteSpacesSyncedBefore(syncStartedAt: Date): Promise<number> {
    const deleteResult = await this.spaces().deleteMany({ syncedAt: { $lt: syncStartedAt } });
    return deleteResult.deletedCount;
  }

  private raw(): Collection<BuildingRawDoc> {
    return mongoCollection<BuildingRawDoc>(config.building.dbName, config.building.collections.buildingsRaw);
  }

  private enriched(): Collection<BuildingDoc> {
    return mongoCollection<BuildingDoc>(config.building.dbName, config.building.collections.buildings);
  }

  private spaces(): Collection<SpaceDoc> {
    return mongoCollection<SpaceDoc>(config.building.dbName, config.building.collections.spaces);
  }
}
