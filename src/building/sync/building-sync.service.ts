import { Injectable } from "@nestjs/common";
import logger from "../../infra/logger";
import {
  BUILD_INFO_CONCURRENCY,
  MIN_BUILDINGS_TO_TRUST,
  MIN_SPACES_FOR_STALE_DELETE,
  needsEnrichment,
  toSyncError,
  type PhaseFailure,
} from "./building-sync.rules";
import { BuildingSyncRepository } from "./building-sync.repository";
import { BuildingSyncClient } from "./building-sync.client";
import { ENRICH_VERSION, enrichBuilding } from "./building-sync.mapper";
import { BuildingRepository } from "../building.repository";
import { CAMPUSES, hasBuildNo } from "../building.rules";
import type { SkkuId } from "../building.types";
import type { ListedBuilding, ListedBuildingWithBuildNo, SyncedSpace } from "./building-sync.types";

/**
 * Mirrors SKKU's campusMap.do into the building DB, weekly
 * (BuildingSyncPoller): phase 1 buildList → raw + enriched layers, phase 2
 * buildInfo → photos + spaces, phase 3 spaceList → spaces + stale delete.
 */
@Injectable()
export class BuildingSyncService {
  constructor(
    private readonly client: BuildingSyncClient,
    private readonly repository: BuildingSyncRepository,
    private readonly buildings: BuildingRepository,
  ) {}

  /**
   * One sync run. Reports by resolving or rejecting, and logs no failure
   * itself: the poller registry turns a rejection into `poller.failing` and a
   * Sentry Issue. Phase 1 failing (a fetch error, or a list too short to trust)
   * ends the run. Phase 2 or 3 failing does not: the later phases and the cache
   * clear still run (a phase 3 failure skips the stale delete), and the run
   * rejects afterwards. Either way the rejection is one AggregateError naming
   * every failed phase, with the original errors in `errors`. Only a run with
   * no failure logs `building.sync.completed`.
   */
  async run(): Promise<void> {
    const syncStartedAt = new Date();
    const start = Date.now();

    let listed: ListedBuilding[];
    try {
      listed = await this.syncBuildList(syncStartedAt);
    } catch (err) {
      throw toSyncError([{ phase: "phase 1 (buildList)", err }]);
    }

    const failures: PhaseFailure[] = [];
    try {
      await this.syncBuildInfo(listed, syncStartedAt);
    } catch (err) {
      failures.push({ phase: "phase 2 (buildInfo)", err });
    }

    let spaceCount = 0;
    try {
      spaceCount = await this.syncSpaceList(syncStartedAt);
    } catch (err) {
      failures.push({ phase: "phase 3 (spaceList)", err });
    }

    this.buildings.clearCache();

    if (failures.length > 0) {
      throw toSyncError(failures);
    }

    logger.info(
      {
        event: "building.sync.completed",
        buildings: listed.length,
        spaces: spaceCount,
        elapsed: Date.now() - start,
      },
      "Building sync complete",
    );
  }

  /** Phase 1: buildList → change detection → raw upsert → enrich. */
  private async syncBuildList(syncStartedAt: Date): Promise<ListedBuilding[]> {
    const listed = await this.fetchTrustedBuildList();
    // Detected before the raw upsert, which overwrites the skkuUpdatedAt it compares against.
    const changedSkkuIds = await this.detectChangedSkkuIds(listed);
    await this.upsertRawBuildings(listed, syncStartedAt);
    await this.enrichChangedBuildings(changedSkkuIds, syncStartedAt);
    return listed;
  }

  /** Both campuses' buildList; throws when it is too short to trust. */
  private async fetchTrustedBuildList(): Promise<ListedBuilding[]> {
    const listed: ListedBuilding[] = [];
    for (const campus of CAMPUSES) {
      const campusBuildings = await this.client.fetchBuildList(campus);
      logger.info(
        { event: "building.sync.buildlist_fetched", campus, count: campusBuildings.length },
        "Phase 1: fetched buildList",
      );
      for (const building of campusBuildings) listed.push(building);
    }

    if (listed.length < MIN_BUILDINGS_TO_TRUST) {
      throw new Error(
        `buildList returned ${listed.length} buildings, fewer than ${MIN_BUILDINGS_TO_TRUST}; nothing written`,
      );
    }
    return listed;
  }

  /** The listed buildings that need enrichment (see needsEnrichment). */
  private async detectChangedSkkuIds(listed: readonly ListedBuilding[]): Promise<Set<SkkuId>> {
    const skkuUpdatedAtBySkkuId = await this.repository.listRawUpdatedAt();
    const skkuIdsEnrichedAtOldVersion = await this.repository.listSkkuIdsNotEnrichedAt(ENRICH_VERSION);
    return new Set(
      listed
        .filter((building) =>
          needsEnrichment({
            knownUpdatedAt: skkuUpdatedAtBySkkuId.get(building.skkuId),
            listedUpdatedAt: building.doc.skkuUpdatedAt,
            isEnrichedAtOldVersion: skkuIdsEnrichedAtOldVersion.has(building.skkuId),
          }),
        )
        .map((building) => building.skkuId),
    );
  }

  private async upsertRawBuildings(listed: readonly ListedBuilding[], syncStartedAt: Date): Promise<void> {
    const rawResult = await this.repository.upsertRaw(listed, syncStartedAt);
    logger.info(
      {
        event: "building.sync.raw_upserted",
        matched: rawResult.matchedCount,
        upserted: rawResult.upsertedCount,
        modified: rawResult.modifiedCount,
      },
      "Phase 1: raw upserted",
    );
  }

  private async enrichChangedBuildings(changedSkkuIds: ReadonlySet<SkkuId>, syncStartedAt: Date): Promise<void> {
    if (changedSkkuIds.size === 0) {
      logger.info(
        { event: "building.sync.enrich_skipped" },
        "Phase 1: no changes detected, skipping enrichment",
      );
      return;
    }

    const changedRaw = await this.repository.listRawBySkkuIds(changedSkkuIds);
    const enrichResult = await this.repository.upsertEnriched(
      changedRaw.map((raw) => ({ skkuId: raw._id, building: enrichBuilding(raw) })),
      syncStartedAt,
    );
    logger.info(
      {
        event: "building.sync.enriched",
        changed: changedSkkuIds.size,
        matched: enrichResult.matchedCount,
        upserted: enrichResult.upsertedCount,
        modified: enrichResult.modifiedCount,
      },
      "Phase 1: enriched buildings updated",
    );
  }

  /** Phase 2: buildInfo per building → photos on both layers + floor spaces. */
  private async syncBuildInfo(listed: readonly ListedBuilding[], syncStartedAt: Date): Promise<void> {
    const withBuildNo = listed.filter((building): building is ListedBuildingWithBuildNo => hasBuildNo(building.doc));
    const spaces: SyncedSpace[] = [];
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < withBuildNo.length; i += BUILD_INFO_CONCURRENCY) {
      const batch = withBuildNo.slice(i, i + BUILD_INFO_CONCURRENCY);
      const outcomes = await Promise.allSettled(
        batch.map((building) => this.syncOneBuildInfo(building, syncStartedAt)),
      );

      for (const [j, outcome] of outcomes.entries()) {
        if (outcome.status === "fulfilled") {
          for (const space of outcome.value) spaces.push(space);
          processed++;
        } else {
          errors++;
          await this.recordBuildInfoFailure(batch[j]!, outcome.reason);
        }
      }
    }

    if (spaces.length > 0) {
      const upsertResult = await this.repository.upsertSpaces(spaces, "buildInfo", syncStartedAt);
      logger.info(
        {
          event: "building.sync.buildinfo_upserted",
          matched: upsertResult.matchedCount,
          upserted: upsertResult.upsertedCount,
          processed,
          errors,
        },
        "Phase 2: buildInfo spaces upserted",
      );
    }
  }

  /** One building's buildInfo: its photos written to both layers, its spaces returned. */
  private async syncOneBuildInfo(building: ListedBuildingWithBuildNo, syncStartedAt: Date): Promise<SyncedSpace[]> {
    const detail = await this.client.fetchBuildInfo(building);
    await this.repository.setAttachments(building.skkuId, detail.attachments, syncStartedAt);
    return detail.spaces;
  }

  /** Logs a building whose buildInfo failed and notes the failure on it. */
  private async recordBuildInfoFailure(building: ListedBuildingWithBuildNo, rejection: unknown): Promise<void> {
    // The reason is unknown (a rejection can be anything); the cast only
    // types it for the log line.
    const reason = rejection as { message?: string } | null | undefined;
    logger.warn(
      {
        event: "building.sync.buildinfo_failed",
        skkuId: building.skkuId,
        buildNo: building.doc.buildNo,
        err: reason,
      },
      "Phase 2: buildInfo failed",
    );
    await this.repository.recordDetailError(building.skkuId, reason?.message || "unknown");
  }

  /** Phase 3: spaceList → spaces upsert + delete of the spaces SKKU no longer lists. */
  private async syncSpaceList(syncStartedAt: Date): Promise<number> {
    const spaces = await this.fetchSpaceLists();
    if (spaces.length > 0) await this.upsertListedSpaces(spaces, syncStartedAt);
    await this.deleteStaleSpaces(spaces.length, syncStartedAt);
    return spaces.length;
  }

  private async fetchSpaceLists(): Promise<SyncedSpace[]> {
    const spaces: SyncedSpace[] = [];
    for (const campus of CAMPUSES) {
      const campusSpaces = await this.client.fetchSpaceList(campus);
      logger.info(
        { event: "building.sync.spacelist_fetched", campus, count: campusSpaces.length },
        "Phase 3: fetched spaceList",
      );
      for (const space of campusSpaces) spaces.push(space);
    }
    return spaces;
  }

  private async upsertListedSpaces(spaces: readonly SyncedSpace[], syncStartedAt: Date): Promise<void> {
    const upsertResult = await this.repository.upsertSpaces(spaces, "spaceList", syncStartedAt);
    logger.info(
      {
        event: "building.sync.spacelist_upserted",
        matched: upsertResult.matchedCount,
        upserted: upsertResult.upsertedCount,
      },
      "Phase 3: spaceList upserted",
    );
  }

  /** Deletes the spaces this run did not see, unless spaceList listed too few to trust. */
  private async deleteStaleSpaces(listedCount: number, syncStartedAt: Date): Promise<void> {
    if (listedCount < MIN_SPACES_FOR_STALE_DELETE) {
      logger.warn(
        { event: "building.sync.stale_delete_skipped", count: listedCount },
        "Suspiciously few spaces, skipping stale delete",
      );
      return;
    }

    const deleted = await this.repository.deleteSpacesSyncedBefore(syncStartedAt);
    if (deleted > 0) {
      logger.info(
        { event: "building.sync.stale_deleted", deleted },
        "Phase 3: stale spaces deleted",
      );
    }
  }
}
