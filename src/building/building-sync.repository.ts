import { Injectable } from "@nestjs/common";
import type { AnyBulkWriteOperation, BulkWriteResult, Collection, Document } from "mongodb";
import config from "../infra/config";
import { getClient } from "../infra/db";
import logger from "../infra/logger";
import type {
  BuildingAttachment,
  BuildingDoc,
  BuildingRawDoc,
  SpaceDoc,
} from "./building.document";
import { toSpaceUpsert, type EnrichmentSetUpdate } from "./building-sync.mapper";
import type { ListedBuilding, SpaceSource, SyncedSpace } from "./building-sync.types";

/**
 * The sync runs weekly, off the request path: a stuck read fails the run
 * instead of hanging it, and the bound is generous enough that a slow cluster
 * does not.
 */
const SYNC_READ_MAX_TIME_MS = 30_000;

function collection<T extends Document>(name: string): Collection<T> {
  return getClient().db(config.building.dbName!).collection<T>(name);
}

/**
 * The building sync's reads and writes: the raw layer (buildings_raw), the
 * enriched layer (buildings) and the spaces. Every write is an upsert keyed by
 * SKKU's own ids, so a rerun converges.
 */
@Injectable()
export class BuildingSyncRepository {
  /** skkuUpdatedAt of every raw building, for change detection. */
  async listRawUpdatedAt(): Promise<Map<number, string | null>> {
    const rawBuildings = await this.raw()
      .find({}, { projection: { skkuUpdatedAt: 1 }, maxTimeMS: SYNC_READ_MAX_TIME_MS })
      .toArray();
    return new Map(rawBuildings.map((d) => [d._id, d.skkuUpdatedAt]));
  }

  /** Enriched buildings whose enrichVersion is not `version`. */
  async listIdsNotEnrichedAt(version: number): Promise<Set<number>> {
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

  listRawByIds(ids: Iterable<number>): Promise<BuildingRawDoc[]> {
    return this.raw()
      .find({ _id: { $in: [...ids] } }, { maxTimeMS: SYNC_READ_MAX_TIME_MS })
      .toArray();
  }

  upsertEnriched(
    entries: ReadonlyArray<{ skkuId: number; fields: EnrichmentSetUpdate }>,
    syncStartedAt: Date,
  ): Promise<BulkWriteResult> {
    const ops: AnyBulkWriteOperation<BuildingDoc>[] = entries.map(({ skkuId, fields }) => ({
      updateOne: {
        filter: { _id: skkuId },
        update: {
          $set: { ...fields, "sync.listAt": syncStartedAt, updatedAt: syncStartedAt },
          $setOnInsert: { extensions: {} },
        },
        upsert: true,
      },
    }));
    return this.enriched().bulkWrite(ops, { ordered: false });
  }

  /** Writes a building's photos to BOTH layers and clears its detail error. */
  async setAttachments(
    skkuId: number,
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
  async recordDetailError(skkuId: number, message: string): Promise<void> {
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
    return collection<BuildingRawDoc>(config.building.collections.buildingsRaw);
  }

  private enriched(): Collection<BuildingDoc> {
    return collection<BuildingDoc>(config.building.collections.buildings);
  }

  private spaces(): Collection<SpaceDoc> {
    return collection<SpaceDoc>(config.building.collections.spaces);
  }
}
