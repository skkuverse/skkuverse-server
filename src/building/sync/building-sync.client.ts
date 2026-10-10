import { Injectable } from "@nestjs/common";
import axios from "axios";
import type { BuildingAttachment, BuildingRawDoc } from "../building.document";
import { SKKU_CAMPUS_CODE } from "../building.rules";
import type { BuildInfo, ListedBuilding, SyncedSpace } from "./building-sync.types";
import type { ApiId, BilingualText, BuildNo, Campus, SkkuId, SpaceCd } from "../building.types";

const CAMPUS_MAP_URL = "https://www.skku.edu/skku/about/campusInfo/campusMap.do";
const REQUEST_TIMEOUT_MS = 30000;

// The campusMap.do payloads (buildList, buildInfo, spaceList). Only the fields
// read here are typed; the real responses carry 25+. SKKU's
// misspellings are kept as sent (longtitude, spcaeNm, spcae_nm, spcae_nm_eng):
// if SKKU ever fixes one silently, the field reads as "" rather than throwing,
// and these names say which field to look at.

interface SkkuBuildListItem {
  /** A numeric string. */
  id: string;
  /** null or absent for a facility. */
  buildNo: string | null;
  buildNm?: string;
  buildNmEng?: string;
  krText?: string;
  enText?: string;
  latitude?: string;
  longtitude?: string;
  filePath?: string;
  encodeNm?: string;
  /** "Y" or anything else. */
  handicappedElevatorYn?: string;
  handicappedToiletYn?: string;
  createDt?: string;
  updateDt?: string;
  [k: string]: unknown;
}

interface SkkuBuildListResponse {
  buildItems?: SkkuBuildListItem[];
  [k: string]: unknown;
}

interface SkkuBuildInfoAttachment {
  id: string;
  file_path?: string;
  encode_nm?: string;
  file_nm?: string;
  image_alt?: string;
  [k: string]: unknown;
}

interface SkkuBuildInfoFloor {
  space_cd: string;
  floor_nm?: string;
  floor_nm_eng?: string;
  spcae_nm?: string;
  /** Sometimes the literal string "undefined". */
  spcae_nm_eng?: string;
  [k: string]: unknown;
}

interface SkkuBuildInfoResponse {
  attachItem?: SkkuBuildInfoAttachment[];
  floorItem?: SkkuBuildInfoFloor[];
  [k: string]: unknown;
}

interface SkkuSpaceListItem {
  spaceCd: string;
  buildNo: string;
  campus: string;
  floorNm?: string;
  floorNmEng?: string;
  spcaeNm?: string;
  /** Sometimes the literal string "undefined". */
  spcaeNmEng?: string;
  buildNm?: string;
  buildNmEng?: string;
  conspaceCd?: string | null;
  [k: string]: unknown;
}

interface SkkuSpaceListResponse {
  items?: SkkuSpaceListItem[];
  [k: string]: unknown;
}

function imageUrl(filePath: string | undefined, encodeNm: string | undefined): string | null {
  if (!filePath || !encodeNm) return null;
  return `https://www.skku.edu${filePath}${encodeNm}`;
}

function text(ko: string | undefined, en: string | undefined): BilingualText {
  return { ko: ko || "", en: en || "" };
}

/** A space name: SKKU sends the literal string "undefined" for a missing English name. */
function spaceName(ko: string | undefined, en: string | undefined): BilingualText {
  return { ko: ko || "", en: en === "undefined" ? "" : en || "" };
}

/** The raw building layer; derived fields (displayNo, type) belong to enrichment. */
function toRawDoc(buildItem: SkkuBuildListItem, campus: Campus): Omit<BuildingRawDoc, "_id"> {
  // `as string` is a type-system assertion only: an undefined latitude still
  // reaches parseFloat and yields NaN, as it always has.
  const lat = parseFloat(buildItem.latitude as string);
  const lng = parseFloat(buildItem.longtitude as string);

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

/**
 * SKKU's campusMap.do: the building list, one building's detail and the space
 * list. Every payload is translated here; nothing past this file sees SKKU's
 * field names.
 */
@Injectable()
export class BuildingSyncClient {
  async fetchBuildList(campus: Campus): Promise<ListedBuilding[]> {
    const { data } = await axios.get<SkkuBuildListResponse>(CAMPUS_MAP_URL, {
      params: { mode: "buildList", srSearchValue: "", campusCd: SKKU_CAMPUS_CODE[campus] },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return (data.buildItems || []).map((buildItem) => ({
      skkuId: parseInt(buildItem.id, 10) as SkkuId,
      apiId: buildItem.id as ApiId,
      doc: toRawDoc(buildItem, campus),
    }));
  }

  async fetchBuildInfo(
    building: ListedBuilding & { doc: { buildNo: BuildNo } },
  ): Promise<BuildInfo> {
    const { doc } = building;
    const { data } = await axios.get<SkkuBuildInfoResponse>(CAMPUS_MAP_URL, {
      params: { mode: "buildInfo", buildNo: doc.buildNo, id: building.apiId },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const attachments: BuildingAttachment[] = (data.attachItem || []).map((attachItem) => ({
      id: attachItem.id,
      url: imageUrl(attachItem.file_path, attachItem.encode_nm),
      filename: attachItem.file_nm || null,
      alt: attachItem.image_alt || "",
    }));
    const spaces: SyncedSpace[] = (data.floorItem || []).map((floorItem) => ({
      spaceCd: floorItem.space_cd as SpaceCd,
      buildNo: doc.buildNo,
      campus: doc.campus,
      floor: text(floorItem.floor_nm, floorItem.floor_nm_eng),
      name: spaceName(floorItem.spcae_nm, floorItem.spcae_nm_eng),
      buildingName: doc.name,
      conspaceCd: null,
    }));
    return { attachments, spaces };
  }

  async fetchSpaceList(campus: Campus): Promise<SyncedSpace[]> {
    const { data } = await axios.get<SkkuSpaceListResponse>(CAMPUS_MAP_URL, {
      params: { mode: "spaceList", srSearchValue: "", campusCd: SKKU_CAMPUS_CODE[campus] },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return (data.items || []).map((spaceItem) => ({
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
