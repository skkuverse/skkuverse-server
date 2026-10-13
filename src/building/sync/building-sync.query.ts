import type { AnyBulkWriteOperation } from "mongodb";
import type { SpaceDoc, SpaceSource } from "../building.document";
import type { EnrichedBuilding, SyncedSpace } from "./building-sync.types";

type SpaceUpsert = AnyBulkWriteOperation<SpaceDoc>;

/** WHY: dot paths, so the $set of name, description and accessibility keeps a subfield the sync does not write. */
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

const spaceKey = (space: SyncedSpace) => ({ spaceCd: space.spaceCd, buildNo: space.buildNo, campus: space.campus });

const spaceNames = (space: SyncedSpace) => ({ floor: space.floor, name: space.name, buildingName: space.buildingName });

/** QUIRK(skku): only spaceList reports `conspaceCd`, so buildInfo sets it on insert only, never over spaceList's. */
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

function toSpaceUpserts(spaces: readonly SyncedSpace[], source: SpaceSource, syncStartedAt: Date): SpaceUpsert[] {
  return spaces.map((space) => SPACE_UPSERT_BY_SOURCE[source](space, syncStartedAt));
}

export { toEnrichedSet, toSpaceUpserts };
