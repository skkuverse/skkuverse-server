import { Injectable } from "@nestjs/common";
import axios from "axios";
import type { BuildingAttachment, BuildingRawDoc } from "./building.document";
import type { BuildInfo, ListedBuilding, SyncedSpace } from "./building-sync.types";
import type { ApiId, BilingualText, BuildNo, Campus, SkkuId, SpaceCd } from "./building.types";

const CAMPUS_MAP_URL = "https://www.skku.edu/skku/about/campusInfo/campusMap.do";
const CAMPUS_CODES: Readonly<Record<Campus, string>> = { hssc: "1", nsc: "2" };
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
function toRawDoc(item: SkkuBuildListItem, campus: Campus): Omit<BuildingRawDoc, "_id"> {
  // `as string` is a type-system assertion only: an undefined latitude still
  // reaches parseFloat and yields NaN, as it always has.
  const lat = parseFloat(item.latitude as string);
  const lng = parseFloat(item.longtitude as string);

  return {
    buildNo: (item.buildNo || null) as BuildNo | null,
    campus,
    name: text(item.buildNm, item.buildNmEng),
    description: text(item.krText, item.enText),
    location: { type: "Point", coordinates: [lng, lat] },
    image: { url: imageUrl(item.filePath, item.encodeNm), filename: item.encodeNm || null },
    accessibility: {
      elevator: item.handicappedElevatorYn === "Y",
      toilet: item.handicappedToiletYn === "Y",
    },
    skkuCreatedAt: item.createDt || null,
    skkuUpdatedAt: item.updateDt || null,
  };
}

/**
 * SKKU's campusMap.do: the building list, one building's detail and the space
 * list. Every payload is translated here; nothing past this file sees SKKU's
 * field names.
 */
@Injectable()
export class BuildingClient {
  async fetchBuildList(campus: Campus): Promise<ListedBuilding[]> {
    const { data } = await axios.get<SkkuBuildListResponse>(CAMPUS_MAP_URL, {
      params: { mode: "buildList", srSearchValue: "", campusCd: CAMPUS_CODES[campus] },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return (data.buildItems || []).map((item) => ({
      skkuId: parseInt(item.id, 10) as SkkuId,
      apiId: item.id as ApiId,
      doc: toRawDoc(item, campus),
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
    const attachments: BuildingAttachment[] = (data.attachItem || []).map((a) => ({
      id: a.id,
      url: imageUrl(a.file_path, a.encode_nm),
      filename: a.file_nm || null,
      alt: a.image_alt || "",
    }));
    const spaces: SyncedSpace[] = (data.floorItem || []).map((fi) => ({
      spaceCd: fi.space_cd as SpaceCd,
      buildNo: doc.buildNo,
      campus: doc.campus,
      floor: text(fi.floor_nm, fi.floor_nm_eng),
      name: spaceName(fi.spcae_nm, fi.spcae_nm_eng),
      buildingName: doc.name,
      conspaceCd: null,
    }));
    return { attachments, spaces };
  }

  async fetchSpaceList(campus: Campus): Promise<SyncedSpace[]> {
    const { data } = await axios.get<SkkuSpaceListResponse>(CAMPUS_MAP_URL, {
      params: { mode: "spaceList", srSearchValue: "", campusCd: CAMPUS_CODES[campus] },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return (data.items || []).map((item) => ({
      spaceCd: item.spaceCd as SpaceCd,
      buildNo: item.buildNo as BuildNo,
      campus,
      floor: text(item.floorNm, item.floorNmEng),
      name: spaceName(item.spcaeNm, item.spcaeNmEng),
      buildingName: text(item.buildNm, item.buildNmEng),
      conspaceCd: item.conspaceCd || null,
    }));
  }
}
