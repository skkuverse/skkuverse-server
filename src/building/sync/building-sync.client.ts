import { Injectable } from "@nestjs/common";
import axios from "axios";
import type { z } from "zod";
import logger from "../../infra/logger";
import { issuePaths, parseEach } from "../../shared/zod-list.util";
import type { BuildingAttachment, BuildingRawDoc } from "../building.document";
import { CAMPUS_MAP_REQUEST_TIMEOUT_MS, CAMPUS_MAP_URL, SKKU_CAMPUS_CODE } from "../building.constants";
import { shouldRejectPayload, toApiId } from "./building-sync.rules";
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
import type { BilingualText, Campus } from "../building.types";

const MAX_LOGGED_INVALID_ITEMS = 10;

type PayloadSource = "buildList" | "buildInfo attachItem" | "buildInfo floorItem" | "spaceList";

interface PayloadList<T> {
  source: PayloadSource;
  scope: string;
  items: readonly unknown[];
  schema: z.ZodType<T>;
  keyField: string;
}

@Injectable()
export class BuildingSyncClient {
  async fetchBuildList(campus: Campus): Promise<ListedBuilding[]> {
    const { data } = await axios.get<unknown>(CAMPUS_MAP_URL, {
      params: { mode: "buildList", srSearchValue: "", campusCd: SKKU_CAMPUS_CODE[campus] },
      timeout: CAMPUS_MAP_REQUEST_TIMEOUT_MS,
    });
    const { buildItems } = this.parseResponse(skkuBuildListResponse, data, `buildList (${campus})`);
    const valid = this.parseItems({ source: "buildList", scope: campus, items: buildItems, schema: skkuBuildListItem, keyField: "id" });
    return valid.map((buildItem) => ({
      skkuId: buildItem.id,
      apiId: toApiId(buildItem.id),
      doc: this.toRawDoc(buildItem, campus),
    }));
  }

  async fetchBuildInfo(building: ListedBuildingWithBuildNo): Promise<BuildInfo> {
    const { doc } = building;
    const { data } = await axios.get<unknown>(CAMPUS_MAP_URL, {
      params: { mode: "buildInfo", buildNo: doc.buildNo, id: building.apiId },
      timeout: CAMPUS_MAP_REQUEST_TIMEOUT_MS,
    });
    const scope = `buildNo ${doc.buildNo}`;
    const { attachItem, floorItem } = this.parseResponse(skkuBuildInfoResponse, data, `buildInfo (${scope})`);
    const attachments: BuildingAttachment[] = this.parseItems({
      source: "buildInfo attachItem",
      scope,
      items: attachItem,
      schema: skkuBuildInfoAttachment,
      keyField: "id",
    }).map((photo) => ({
      id: photo.id,
      url: this.toImageUrl(photo.file_path, photo.encode_nm),
      filename: photo.file_nm || null,
      alt: photo.image_alt || "",
    }));
    const spaces: SyncedSpace[] = this.parseItems({
      source: "buildInfo floorItem",
      scope,
      items: floorItem,
      schema: skkuBuildInfoFloor,
      keyField: "space_cd",
    }).map((floorSpace) => ({
      spaceCd: floorSpace.space_cd,
      buildNo: doc.buildNo,
      campus: doc.campus,
      floor: this.toBilingualText(floorSpace.floor_nm, floorSpace.floor_nm_eng),
      name: this.toSpaceName(floorSpace.spcae_nm, floorSpace.spcae_nm_eng),
      buildingName: doc.name,
      conspaceCd: null,
    }));
    return { attachments, spaces };
  }

  async fetchSpaceList(campus: Campus): Promise<SyncedSpace[]> {
    const { data } = await axios.get<unknown>(CAMPUS_MAP_URL, {
      params: { mode: "spaceList", srSearchValue: "", campusCd: SKKU_CAMPUS_CODE[campus] },
      timeout: CAMPUS_MAP_REQUEST_TIMEOUT_MS,
    });
    const { items } = this.parseResponse(skkuSpaceListResponse, data, `spaceList (${campus})`);
    const valid = this.parseItems({ source: "spaceList", scope: campus, items, schema: skkuSpaceListItem, keyField: "spaceCd" });
    return valid.map((spaceItem) => ({
      spaceCd: spaceItem.spaceCd,
      buildNo: spaceItem.buildNo,
      campus,
      floor: this.toBilingualText(spaceItem.floorNm, spaceItem.floorNmEng),
      name: this.toSpaceName(spaceItem.spcaeNm, spaceItem.spcaeNmEng),
      buildingName: this.toBilingualText(spaceItem.buildNm, spaceItem.buildNmEng),
      conspaceCd: spaceItem.conspaceCd || null,
    }));
  }

  /** WHY: a wrong response shape (a renamed or missing list) breaks every item at once, so it throws. */
  private parseResponse<T>(schema: z.ZodType<T>, data: unknown, where: string): T {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`campusMap.do ${where} is not the expected shape: ${issuePaths(parsed.error)}`);
    }
    return parsed.data;
  }

  private itemKey(item: unknown, keyField: string, index: number): string {
    const key = typeof item === "object" && item !== null ? (item as Record<string, unknown>)[keyField] : undefined;
    return typeof key === "number" || (typeof key === "string" && key !== "") ? String(key) : `#${index}`;
  }

  private parseItems<T>(list: PayloadList<T>): T[] {
    const { valid, invalid } = parseEach(list.items, list.schema, (item, index) => this.itemKey(item, list.keyField, index));
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

  private toImageUrl(filePath: string | undefined, encodeNm: string | undefined): string | null {
    if (!filePath || !encodeNm) return null;
    return `https://www.skku.edu${filePath}${encodeNm}`;
  }

  private toBilingualText(ko: string | undefined, en: string | undefined): BilingualText {
    return { ko: ko || "", en: en || "" };
  }

  /** QUIRK(skku): a space without an English name omits it or sends the literal string "undefined". */
  private toSpaceName(ko: string | undefined, en: string | undefined): BilingualText {
    return { ko: ko || "", en: en === "undefined" ? "" : en || "" };
  }

  private toRawDoc(buildItem: SkkuBuildListItem, campus: Campus): Omit<BuildingRawDoc, "_id"> {
    const lat = parseFloat(buildItem.latitude);
    const lng = parseFloat(buildItem.longtitude);

    return {
      buildNo: buildItem.buildNo || null,
      campus,
      name: this.toBilingualText(buildItem.buildNm, buildItem.buildNmEng),
      description: this.toBilingualText(buildItem.krText, buildItem.enText),
      location: { type: "Point", coordinates: [lng, lat] },
      image: { url: this.toImageUrl(buildItem.filePath, buildItem.encodeNm), filename: buildItem.encodeNm || null },
      accessibility: {
        elevator: buildItem.handicappedElevatorYn === "Y",
        toilet: buildItem.handicappedToiletYn === "Y",
      },
      skkuCreatedAt: buildItem.createDt || null,
      skkuUpdatedAt: buildItem.updateDt || null,
    };
  }
}
