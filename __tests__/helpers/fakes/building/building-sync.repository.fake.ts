/**
 * In-memory BuildingSyncRepository over the raw layer, the enriched layer and
 * the spaces, following the real repository's write rules:
 *  - upsertRaw and upsertEnriched upsert by skkuId and stamp `sync.listAt`
 *  - setAttachments writes the photos to whichever layers hold the building and
 *    clears its detailError
 *  - recordDetailError notes the message on both layers
 *  - upsertSpaces upserts by spaceCd + buildNo + campus and adds the source;
 *    a buildInfo insert starts conspaceCd as null
 *  - deleteSpacesSyncedBefore deletes the spaces stamped before the cutoff
 * recordDetailError's best-effort logging is the real repository's own and is
 * tested in building-sync.repository.spec.ts. The `*Failures` fields inject the
 * write errors the service has to survive.
 */
import type { BulkWriteResult } from "mongodb";
import type {
  BuildingAttachment,
  BuildingDoc,
  BuildingRawDoc,
  SpaceDoc,
  SpaceSource,
} from "../../../../src/building/building.document";
import type { SkkuId } from "../../../../src/building/building.types";
import type { BuildingSyncRepository } from "../../../../src/building/sync/building-sync.repository";
import type { EnrichedBuilding, ListedBuilding, SyncedSpace } from "../../../../src/building/sync/building-sync.types";
import type { PublicOf } from "../public-of";

export type StoredSpace = SpaceDoc & { sources: SpaceSource[]; syncedAt: Date };

/** The counts a bulk upsert reports; the service logs these and nothing else. */
function bulkResult(matched: number, upserted: number, modified: number): BulkWriteResult {
  return { matchedCount: matched, upsertedCount: upserted, modifiedCount: modified } as unknown as BulkWriteResult;
}

const spaceKey = (space: Pick<SyncedSpace, "spaceCd" | "buildNo" | "campus">): string =>
  `${space.campus}/${space.buildNo}/${space.spaceCd}`;

export class FakeBuildingSyncRepository implements PublicOf<BuildingSyncRepository> {
  raw = new Map<SkkuId, BuildingRawDoc>();
  enriched = new Map<SkkuId, BuildingDoc>();
  spaces = new Map<string, StoredSpace>();
  /** The source of each upsertSpaces call, in order. */
  spaceUpserts: SpaceSource[] = [];
  /** Each upsertSpaces call rejects with the next error until the list is empty. */
  upsertSpacesFailures: Error[] = [];
  /** setAttachments rejects for these buildings and writes nothing. */
  setAttachmentsFailures = new Map<SkkuId, Error>();

  async onModuleInit(): Promise<void> {}

  async ensureIndexes(): Promise<void> {}

  async listRawUpdatedAt(): Promise<Map<SkkuId, string | null>> {
    return new Map([...this.raw.values()].map((doc) => [doc._id, doc.skkuUpdatedAt]));
  }

  async listSkkuIdsNotEnrichedAt(version: number): Promise<Set<SkkuId>> {
    return new Set([...this.enriched.values()].filter((doc) => doc.enrichVersion !== version).map((doc) => doc._id));
  }

  async upsertRaw(listed: readonly ListedBuilding[], syncStartedAt: Date): Promise<BulkWriteResult> {
    let matched = 0;
    for (const { skkuId, doc } of listed) {
      const known = this.raw.get(skkuId);
      if (known) matched++;
      this.raw.set(skkuId, { ...known, ...doc, _id: skkuId, sync: { ...known?.sync, listAt: syncStartedAt } });
    }
    return bulkResult(matched, listed.length - matched, matched);
  }

  async listRawBySkkuIds(skkuIds: Iterable<SkkuId>): Promise<BuildingRawDoc[]> {
    return [...skkuIds].flatMap((skkuId) => this.raw.get(skkuId) ?? []);
  }

  async upsertEnriched(
    entries: ReadonlyArray<{ skkuId: SkkuId; building: EnrichedBuilding }>,
    syncStartedAt: Date,
  ): Promise<BulkWriteResult> {
    let matched = 0;
    for (const { skkuId, building } of entries) {
      const known = this.enriched.get(skkuId);
      if (known) matched++;
      this.enriched.set(skkuId, {
        extensions: {},
        ...known,
        ...building,
        _id: skkuId,
        sync: { ...known?.sync, listAt: syncStartedAt },
        updatedAt: syncStartedAt,
      });
    }
    return bulkResult(matched, entries.length - matched, matched);
  }

  async setAttachments(skkuId: SkkuId, attachments: BuildingAttachment[], syncStartedAt: Date): Promise<void> {
    const failure = this.setAttachmentsFailures.get(skkuId);
    if (failure) throw failure;
    for (const layer of [this.raw, this.enriched] as Array<Map<SkkuId, BuildingRawDoc | BuildingDoc>>) {
      const doc = layer.get(skkuId);
      if (doc) layer.set(skkuId, { ...doc, attachments, sync: { ...doc.sync, detailAt: syncStartedAt, detailError: null } });
    }
  }

  async recordDetailError(skkuId: SkkuId, message: string): Promise<void> {
    for (const layer of [this.raw, this.enriched] as Array<Map<SkkuId, BuildingRawDoc | BuildingDoc>>) {
      const doc = layer.get(skkuId);
      if (doc) layer.set(skkuId, { ...doc, sync: { ...doc.sync, detailError: message } });
    }
  }

  async upsertSpaces(
    spaces: readonly SyncedSpace[],
    source: SpaceSource,
    syncStartedAt: Date,
  ): Promise<BulkWriteResult> {
    this.spaceUpserts.push(source);
    const failure = this.upsertSpacesFailures.shift();
    if (failure) throw failure;
    let matched = 0;
    for (const space of spaces) {
      const key = spaceKey(space);
      const known = this.spaces.get(key);
      if (known) matched++;
      const sources = known?.sources.includes(source) ? known.sources : [...(known?.sources ?? []), source];
      const conspaceCd = source === "spaceList" ? space.conspaceCd : (known?.conspaceCd ?? null);
      this.spaces.set(key, {
        spaceCd: space.spaceCd,
        buildNo: space.buildNo,
        campus: space.campus,
        floor: space.floor,
        name: space.name,
        buildingName: space.buildingName,
        conspaceCd,
        sources,
        syncedAt: syncStartedAt,
      });
    }
    return bulkResult(matched, spaces.length - matched, matched);
  }

  async deleteSpacesSyncedBefore(syncStartedAt: Date): Promise<number> {
    let deleted = 0;
    for (const [key, space] of this.spaces) {
      if (space.syncedAt < syncStartedAt) {
        this.spaces.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /** The spaces a source has written, by spaceCd. */
  spaceCdsFrom(source: SpaceSource): string[] {
    return [...this.spaces.values()].filter((space) => space.sources.includes(source)).map((space) => space.spaceCd);
  }
}
