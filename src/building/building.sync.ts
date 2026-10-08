import axios from "axios";
import type { AnyBulkWriteOperation } from "mongodb";
import logger from "../infra/logger";
import {
  clearCache,
  getBuildingsCollection,
  getRawBuildingsCollection,
  getSpacesCollection,
} from "./building.data";
import { ENRICH_VERSION, enrichBuilding } from "./building.enrich";
import type {
  BuildingAttachment,
  BuildingDoc,
  BuildingRawDoc,
  Campus,
  SkkuBuildInfoResponse,
  SkkuBuildListItem,
  SkkuBuildListResponse,
  SkkuSpaceListItem,
  SkkuSpaceListResponse,
  SpaceDoc,
} from "./types";

const SKKU_API = "https://www.skku.edu/skku/about/campusInfo/campusMap.do";
const CAMPUS_CODES: Array<{ cd: string; name: Campus }> = [
  { cd: "1", name: "hssc" },
  { cd: "2", name: "nsc" },
];

const MIN_BUILDINGS = 50;
const MIN_SPACES = 5000;
const CONCURRENCY = 5;

// --- Helpers ---

function buildImageUrl(
  filePath: string | undefined,
  encodeNm: string | undefined,
): string | null {
  if (!filePath || !encodeNm) return null;
  return `https://www.skku.edu${filePath}${encodeNm}`;
}

/**
 * Build a raw building document from SKKU API item.
 * No derived fields (displayNo, type) — those belong to the enriched layer.
 */
function toRawDoc(
  item: SkkuBuildListItem,
  campus: Campus,
): Omit<BuildingRawDoc, "_id"> {
  // `as string` is a type-system assertion only: an undefined latitude still
  // reaches parseFloat and yields NaN. (A `?? ""` default would be defensive
  // narrowing — parseFloat("") is NaN too, but the intent would differ.)
  const lat = parseFloat(item.latitude as string);
  const lng = parseFloat(item.longtitude as string); // SKKU typo

  return {
    buildNo: item.buildNo || null,
    campus,
    name: { ko: item.buildNm || "", en: item.buildNmEng || "" },
    description: { ko: item.krText || "", en: item.enText || "" },
    location: {
      type: "Point",
      coordinates: [lng, lat],
    },
    image: {
      url: buildImageUrl(item.filePath, item.encodeNm),
      filename: item.encodeNm || null,
    },
    accessibility: {
      elevator: item.handicappedElevatorYn === "Y",
      toilet: item.handicappedToiletYn === "Y",
    },
    skkuCreatedAt: item.createDt || null,
    skkuUpdatedAt: item.updateDt || null,
  };
}

// --- Phase 1: buildList → raw upsert → change detection → enrich ---

async function fetchBuildList(campusCd: string): Promise<SkkuBuildListItem[]> {
  const { data } = await axios.get<SkkuBuildListResponse>(SKKU_API, {
    params: { mode: "buildList", srSearchValue: "", campusCd },
    timeout: 30000,
  });
  return data.buildItems || [];
}

interface CampusItem {
  item: SkkuBuildListItem;
  campus: Campus;
}

async function phase1(syncTime: Date): Promise<CampusItem[]> {
  const rawCol = getRawBuildingsCollection();
  const enrichedCol = getBuildingsCollection();
  const allItems: CampusItem[] = [];

  for (const { cd, name } of CAMPUS_CODES) {
    const items = await fetchBuildList(cd);
    logger.info(
      { event: "building.sync.buildlist_fetched", campus: name, count: items.length },
      "Phase 1: fetched buildList",
    );
    for (const item of items) {
      allItems.push({ item, campus: name });
    }
  }

  // Sanity check: a short list means SKKU answered without usable data (an
  // empty body, a renamed field), so nothing is written and the run fails.
  if (allItems.length < MIN_BUILDINGS) {
    throw new Error(
      `buildList returned ${allItems.length} buildings, fewer than ${MIN_BUILDINGS}; nothing written`,
    );
  }

  // Load existing raw docs for change detection (single query, 78 docs)
  const existingRawDocs = await rawCol
    .find({}, { projection: { skkuUpdatedAt: 1 } })
    .toArray();
  const rawMap = new Map<number, string | null>(
    existingRawDocs.map((d) => [d._id, d.skkuUpdatedAt]),
  );

  // Load IDs needing re-enrichment due to version mismatch
  const staleEnrichedIds = new Set<number>(
    (
      await enrichedCol
        .find({ enrichVersion: { $ne: ENRICH_VERSION } }, { projection: { _id: 1 } })
        .toArray()
    ).map((d) => d._id),
  );

  // Build raw upsert ops + detect changed IDs
  const rawOps: AnyBulkWriteOperation<BuildingRawDoc>[] = [];
  const changedIds = new Set<number>();

  for (const { item, campus } of allItems) {
    const skkuId = parseInt(item.id, 10);
    const rawDoc = toRawDoc(item, campus);

    rawOps.push({
      updateOne: {
        filter: { _id: skkuId },
        update: { $set: { ...rawDoc, "sync.listAt": syncTime } },
        upsert: true,
      },
    });

    // Change detection: new, data updated, or enrichment version mismatch
    const existingUpdatedAt = rawMap.get(skkuId);
    if (
      existingUpdatedAt === undefined || // new building
      existingUpdatedAt !== rawDoc.skkuUpdatedAt || // SKKU data changed
      staleEnrichedIds.has(skkuId) // enrichment version bump
    ) {
      changedIds.add(skkuId);
    }
  }

  // Upsert raw layer
  const rawResult = await rawCol.bulkWrite(rawOps, { ordered: false });
  logger.info(
    {
      event: "building.sync.raw_upserted",
      matched: rawResult.matchedCount,
      upserted: rawResult.upsertedCount,
      modified: rawResult.modifiedCount,
    },
    "Phase 1: raw upserted",
  );

  // Enrich changed buildings → upsert enriched layer
  if (changedIds.size > 0) {
    // Re-read changed raw docs (with full data for enrichment)
    const changedRawDocs = await rawCol
      .find({ _id: { $in: [...changedIds] } })
      .toArray();

    const enrichedOps: AnyBulkWriteOperation<BuildingDoc>[] = changedRawDocs.map(
      (rawDoc) => {
        const fields = enrichBuilding(rawDoc);
        return {
          updateOne: {
            filter: { _id: rawDoc._id },
            update: {
              $set: { ...fields, "sync.listAt": syncTime, updatedAt: syncTime },
              $setOnInsert: { extensions: {} },
            },
            upsert: true,
          },
        };
      },
    );

    const enrichResult = await enrichedCol.bulkWrite(enrichedOps, {
      ordered: false,
    });
    logger.info(
      {
        event: "building.sync.enriched",
        changed: changedIds.size,
        matched: enrichResult.matchedCount,
        upserted: enrichResult.upsertedCount,
        modified: enrichResult.modifiedCount,
      },
      "Phase 1: enriched buildings updated",
    );
  } else {
    logger.info(
      { event: "building.sync.enrich_skipped" },
      "Phase 1: no changes detected, skipping enrichment",
    );
  }

  return allItems;
}

// --- Phase 2: buildInfo (attachments + floorItem → spaces) ---

async function fetchBuildInfo(
  buildNo: string,
  skkuId: string,
): Promise<SkkuBuildInfoResponse> {
  const { data } = await axios.get<SkkuBuildInfoResponse>(SKKU_API, {
    params: { mode: "buildInfo", buildNo, id: skkuId },
    timeout: 30000,
  });
  return data;
}

async function phase2(
  allItems: CampusItem[],
  syncTime: Date,
): Promise<{ processed: number; errors: number; spacesCount: number }> {
  const rawCol = getRawBuildingsCollection();
  const enrichedCol = getBuildingsCollection();
  const spacesCol = getSpacesCollection();

  // facility(buildNo=null)는 buildInfo 호출 대상 아님.
  const withBuildNo = allItems.filter(
    (ci): ci is CampusItem & { item: SkkuBuildListItem & { buildNo: string } } =>
      !!ci.item.buildNo,
  );

  const spacesOps: AnyBulkWriteOperation<SpaceDoc>[] = [];
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < withBuildNo.length; i += CONCURRENCY) {
    const batch = withBuildNo.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ item, campus }) => {
        const info = await fetchBuildInfo(item.buildNo, item.id);
        const skkuId = parseInt(item.id, 10);

        const attachments: BuildingAttachment[] = (info.attachItem || []).map(
          (a) => ({
            id: a.id,
            url: buildImageUrl(a.file_path, a.encode_nm),
            filename: a.file_nm || null,
            alt: a.image_alt || "",
          }),
        );

        // Write attachments to BOTH raw and enriched layers
        const attachUpdate = {
          $set: {
            attachments,
            "sync.detailAt": syncTime,
            "sync.detailError": null,
          },
        };
        await Promise.all([
          rawCol.updateOne({ _id: skkuId }, attachUpdate),
          enrichedCol.updateOne({ _id: skkuId }, attachUpdate),
        ]);

        // floorItem → spaces upsert ops
        const buildingName = {
          ko: item.buildNm || "",
          en: item.buildNmEng || "",
        };
        for (const fi of info.floorItem || []) {
          spacesOps.push({
            updateOne: {
              filter: {
                spaceCd: fi.space_cd,
                buildNo: item.buildNo,
                campus,
              },
              update: {
                $set: {
                  floor: {
                    ko: fi.floor_nm || "",
                    en: fi.floor_nm_eng || "",
                  },
                  name: {
                    ko: fi.spcae_nm || "", // SKKU typo
                    en:
                      fi.spcae_nm_eng === "undefined"
                        ? ""
                        : fi.spcae_nm_eng || "",
                  },
                  buildingName,
                  syncedAt: syncTime,
                },
                $addToSet: { sources: "buildInfo" },
                $setOnInsert: { conspaceCd: null },
              },
              upsert: true,
            },
          });
        }

        processed++;
      }),
    );

    // Record errors
    for (const r of results) {
      if (r.status === "rejected") {
        errors++;
        const failedItem = batch[results.indexOf(r)]!;
        const skkuId = parseInt(failedItem.item.id, 10);
        // r.reason is unknown (a Promise rejection can be anything); the cast
        // only types it for the log line.
        const reason = r.reason as { message?: string } | null | undefined;
        logger.warn(
          {
            event: "building.sync.buildinfo_failed",
            skkuId,
            buildNo: failedItem.item.buildNo,
            err: reason,
          },
          "Phase 2: buildInfo failed",
        );
        const errUpdate = {
          $set: { "sync.detailError": reason?.message || "unknown" },
        };
        // Best effort: the sync goes on without the error note.
        const noteFailed = (err: unknown): void =>
          logger.warn(
            { event: "building.sync.error_note_failed", skkuId, err },
            "Could not record the buildInfo failure on the building",
          );
        await Promise.all([
          rawCol.updateOne({ _id: skkuId }, errUpdate).catch(noteFailed),
          enrichedCol.updateOne({ _id: skkuId }, errUpdate).catch(noteFailed),
        ]);
      }
    }
  }

  if (spacesOps.length > 0) {
    const result = await spacesCol.bulkWrite(spacesOps, { ordered: false });
    logger.info(
      {
        event: "building.sync.buildinfo_upserted",
        matched: result.matchedCount,
        upserted: result.upsertedCount,
        processed,
        errors,
      },
      "Phase 2: buildInfo spaces upserted",
    );
  }

  return { processed, errors, spacesCount: spacesOps.length };
}

// --- Phase 3: spaceList (unchanged — no two-layer needed) ---

async function fetchSpaceList(campusCd: string): Promise<SkkuSpaceListItem[]> {
  const { data } = await axios.get<SkkuSpaceListResponse>(SKKU_API, {
    params: { mode: "spaceList", srSearchValue: "", campusCd },
    timeout: 30000,
  });
  return data.items || [];
}

async function phase3(syncTime: Date): Promise<number> {
  const spacesCol = getSpacesCollection();
  const allSpaces: Array<{
    item: SkkuSpaceListItem;
    campus: Campus;
  }> = [];

  for (const { cd, name } of CAMPUS_CODES) {
    const items = await fetchSpaceList(cd);
    logger.info(
      { event: "building.sync.spacelist_fetched", campus: name, count: items.length },
      "Phase 3: fetched spaceList",
    );
    for (const item of items) {
      allSpaces.push({ item, campus: name });
    }
  }

  const ops: AnyBulkWriteOperation<SpaceDoc>[] = allSpaces.map(
    ({ item, campus }) => ({
      updateOne: {
        filter: {
          spaceCd: item.spaceCd,
          buildNo: item.buildNo,
          campus,
        },
        update: {
          $set: {
            floor: { ko: item.floorNm || "", en: item.floorNmEng || "" },
            name: {
              ko: item.spcaeNm || "", // SKKU typo
              en:
                item.spcaeNmEng === "undefined"
                  ? ""
                  : item.spcaeNmEng || "",
            },
            buildingName: {
              ko: item.buildNm || "",
              en: item.buildNmEng || "",
            },
            conspaceCd: item.conspaceCd || null,
            syncedAt: syncTime,
          },
          $addToSet: { sources: "spaceList" },
        },
        upsert: true,
      },
    }),
  );

  if (ops.length > 0) {
    const result = await spacesCol.bulkWrite(ops, { ordered: false });
    logger.info(
      {
        event: "building.sync.spacelist_upserted",
        matched: result.matchedCount,
        upserted: result.upsertedCount,
      },
      "Phase 3: spaceList upserted",
    );
  }

  if (allSpaces.length < MIN_SPACES) {
    logger.warn(
      { event: "building.sync.stale_delete_skipped", count: allSpaces.length },
      "Suspiciously few spaces, skipping stale delete",
    );
    return allSpaces.length;
  }

  const deleteResult = await spacesCol.deleteMany({
    syncedAt: { $lt: syncTime },
  });
  if (deleteResult.deletedCount > 0) {
    logger.info(
      { event: "building.sync.stale_deleted", deleted: deleteResult.deletedCount },
      "Phase 3: stale spaces deleted",
    );
  }

  return allSpaces.length;
}

// --- Main sync ---

interface PhaseFailure {
  phase: string;
  err: unknown;
}

/** The run's one rejection: the failed phases by name, their errors in `errors`. */
function syncFailed(failures: PhaseFailure[]): AggregateError {
  return new AggregateError(
    failures.map((f) => f.err),
    `Building sync failed in ${failures.map((f) => f.phase).join(" and ")}`,
  );
}

/**
 * One sync run: phase 1 buildList → raw + enriched layers, phase 2 buildInfo →
 * attachments + spaces, phase 3 spaceList → spaces + stale delete.
 *
 * Reports by resolving or rejecting, and logs no failure itself: the poller
 * registry turns a rejection into `poller.failing` and a Sentry Issue. Phase 1
 * failing (a fetch error, or a list too short to trust) ends the run. Phase 2
 * or 3 failing does not: the later phases and clearCache() still run (a phase 3
 * failure skips the stale delete), and the run rejects afterwards. Either way
 * the rejection is one AggregateError naming every failed phase, with the
 * original errors in `errors`. Only a run with no failure logs
 * `building.sync.completed`.
 */
async function syncBuildings(): Promise<void> {
  const syncTime = new Date();
  const start = Date.now();

  // Phase 1: buildList → raw + enriched (two-layer)
  let allItems: CampusItem[];
  try {
    allItems = await phase1(syncTime);
  } catch (err) {
    throw syncFailed([{ phase: "phase 1 (buildList)", err }]);
  }

  const failures: PhaseFailure[] = [];

  // Phase 2: buildInfo → attachments (both layers) + spaces
  try {
    await phase2(allItems, syncTime);
  } catch (err) {
    failures.push({ phase: "phase 2 (buildInfo)", err });
  }

  // Phase 3: spaceList → spaces upsert + stale delete
  let spacesCount = 0;
  try {
    spacesCount = await phase3(syncTime);
  } catch (err) {
    failures.push({ phase: "phase 3 (spaceList)", err });
  }

  clearCache();

  if (failures.length > 0) {
    throw syncFailed(failures);
  }

  const elapsed = Date.now() - start;
  logger.info(
    {
      event: "building.sync.completed",
      buildings: allItems.length,
      spaces: spacesCount,
      elapsed,
    },
    "Building sync complete",
  );
}

// Scheduling is owned by BuildingSyncService, which registers syncBuildings with
// the Nest PollerRegistry (ROLE-gated). No module-load side-effect registration
// here.
export { syncBuildings };
