import { Injectable } from "@nestjs/common";
import axios from "axios";
import type { z } from "zod";
import logger from "../../infra/logger";
import type { BuildingAttachment, BuildingRawDoc } from "../building.document";
import { SKKU_CAMPUS_CODE } from "../building.rules";
import { shouldRejectPayload } from "./building-sync.rules";
import {
  skkuBuildInfoAttachment,
  skkuBuildInfoFloor,
  skkuBuildInfoResponse,
  skkuBuildListItem,
  skkuBuildListResponse,
  skkuSpaceListItem,
  skkuSpaceListResponse,
  type SkkuBuildListItem,
} from "./building-sync.schema";
import type { BuildInfo, ListedBuilding, ListedBuildingWithBuildNo, SyncedSpace } from "./building-sync.types";
import type { ApiId, BilingualText, BuildNo, Campus, SkkuId, SpaceCd } from "../building.types";

const CAMPUS_MAP_URL = "https://www.skku.edu/skku/about/campusInfo/campusMap.do";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_LOGGED_INVALID_ITEMS = 10;

type PayloadSource = "buildList" | "buildInfo attachItem" | "buildInfo floorItem" | "spaceList";

interface PayloadList<T> {
  source: PayloadSource;
  scope: string;
  items: readonly unknown[];
  schema: z.ZodType<T>;
  keyField: string;
}

function issuePaths(error: z.ZodError): string {
  const paths = error.issues.map((issue) => issue.path.join(".") || "(root)");
  return [...new Set(paths)].join(", ");
}

/** WHY: a wrong response shape (a renamed or missing list) breaks every item at once, so it throws. */
function parseResponse<T>(schema: z.ZodType<T>, data: unknown, where: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`campusMap.do ${where} is not the expected shape: ${issuePaths(parsed.error)}`);
  }
  return parsed.data;
}

function itemKey(item: unknown, keyField: string, index: number): string {
  const key = typeof item === "object" && item !== null ? (item as Record<string, unknown>)[keyField] : undefined;
  return typeof key === "number" || (typeof key === "string" && key !== "") ? String(key) : `#${index}`;
}

function parseItems<T>(list: PayloadList<T>): T[] {
  const valid: T[] = [];
  const invalid: string[] = [];
  list.items.forEach((item, index) => {
    const parsed = list.schema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
    else invalid.push(`${itemKey(item, list.keyField, index)}: ${issuePaths(parsed.error)}`);
  });
  const total = list.items.length;
  if (invalid.length > 0) {
    logger.warn(
      {
        event: "building.sync.payload_items_dropped",
        source: list.source,
        scope: list.scope,
        dropped: invalid.length,
        total,
        invalid: invalid.slice(0, MAX_LOGGED_INVALID_ITEMS),
      },
      "SKKU payload items left out: they do not match the schema",
    );
  }
  if (shouldRejectPayload({ total, invalid: invalid.length })) {
    throw new Error(`campusMap.do ${list.source} (${list.scope}) returned ${invalid.length} invalid items of ${total}`);
  }
  return valid;
}

function imageUrl(filePath: string | undefined, encodeNm: string | undefined): string | null {
  if (!filePath || !encodeNm) return null;
  return `https://www.skku.edu${filePath}${encodeNm}`;
}

function text(ko: string | undefined, en: string | undefined): BilingualText {
  return { ko: ko || "", en: en || "" };
}

/** QUIRK(skku): a space without an English name omits it or sends the literal string "undefined". */
function spaceName(ko: string | undefined, en: string | undefined): BilingualText {
  return { ko: ko || "", en: en === "undefined" ? "" : en || "" };
}

function toRawDoc(buildItem: SkkuBuildListItem, campus: Campus): Omit<BuildingRawDoc, "_id"> {
  const lat = parseFloat(buildItem.latitude);
  const lng = parseFloat(buildItem.longtitude);

  return {
    buildNo: (buildItem.buildNo || null) as BuildNo | null,
    campus,
    name: text(buildItem.buildNm, buildItem.buildNmEng),
    description: text(buildItem.krText, buildItem.enText),
    location: { type: "Point", coordinates: [lng, lat] },
    image: { url: imageUrl(buildItem.filePath, buildItem.encodeNm), filename: buildItem.encodeNm || null },
    accessibility: {
      elevator: buildItem.handicappedElevatorYn === "Y",
      toilet: buildItem.handicappedToiletYn === "Y",
    },
    skkuCreatedAt: buildItem.createDt || null,
    skkuUpdatedAt: buildItem.updateDt || null,
  };
}

@Injectable()
export class BuildingSyncClient {
  async fetchBuildList(campus: Campus): Promise<ListedBuilding[]> {
    const { data } = await axios.get<unknown>(CAMPUS_MAP_URL, {
      params: { mode: "buildList", srSearchValue: "", campusCd: SKKU_CAMPUS_CODE[campus] },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const { buildItems } = parseResponse(skkuBuildListResponse, data, `buildList (${campus})`);
    const valid = parseItems({ source: "buildList", scope: campus, items: buildItems, schema: skkuBuildListItem, keyField: "id" });
    return valid.map((buildItem) => ({
      skkuId: buildItem.id as SkkuId,
      apiId: buildItem.id as ApiId,
      doc: toRawDoc(buildItem, campus),
    }));
  }

  async fetchBuildInfo(building: ListedBuildingWithBuildNo): Promise<BuildInfo> {
    const { doc } = building;
    const { data } = await axios.get<unknown>(CAMPUS_MAP_URL, {
      params: { mode: "buildInfo", buildNo: doc.buildNo, id: building.apiId },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const scope = `buildNo ${doc.buildNo}`;
    const { attachItem, floorItem } = parseResponse(skkuBuildInfoResponse, data, `buildInfo (${scope})`);
    const attachments: BuildingAttachment[] = parseItems({
      source: "buildInfo attachItem",
      scope,
      items: attachItem,
      schema: skkuBuildInfoAttachment,
      keyField: "id",
    }).map((photo) => ({
      id: photo.id,
      url: imageUrl(photo.file_path, photo.encode_nm),
      filename: photo.file_nm || null,
      alt: photo.image_alt || "",
    }));
    const spaces: SyncedSpace[] = parseItems({
      source: "buildInfo floorItem",
      scope,
      items: floorItem,
      schema: skkuBuildInfoFloor,
      keyField: "space_cd",
    }).map((floorSpace) => ({
      spaceCd: floorSpace.space_cd as SpaceCd,
      buildNo: doc.buildNo,
      campus: doc.campus,
      floor: text(floorSpace.floor_nm, floorSpace.floor_nm_eng),
      name: spaceName(floorSpace.spcae_nm, floorSpace.spcae_nm_eng),
      buildingName: doc.name,
      conspaceCd: null,
    }));
    return { attachments, spaces };
  }

  async fetchSpaceList(campus: Campus): Promise<SyncedSpace[]> {
    const { data } = await axios.get<unknown>(CAMPUS_MAP_URL, {
      params: { mode: "spaceList", srSearchValue: "", campusCd: SKKU_CAMPUS_CODE[campus] },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const { items } = parseResponse(skkuSpaceListResponse, data, `spaceList (${campus})`);
    const valid = parseItems({ source: "spaceList", scope: campus, items, schema: skkuSpaceListItem, keyField: "spaceCd" });
    return valid.map((spaceItem) => ({
      spaceCd: spaceItem.spaceCd as SpaceCd,
      buildNo: spaceItem.buildNo as BuildNo,
      campus,
      floor: text(spaceItem.floorNm, spaceItem.floorNmEng),
      name: spaceName(spaceItem.spcaeNm, spaceItem.spcaeNmEng),
      buildingName: text(spaceItem.buildNm, spaceItem.buildNmEng),
      conspaceCd: spaceItem.conspaceCd || null,
    }));
  }
}
