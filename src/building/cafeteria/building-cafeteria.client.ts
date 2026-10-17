import { Injectable } from "@nestjs/common";
import axios from "axios";
import logger from "../../infra/logger";
import { issuePaths, parseEach } from "../../shared/zod-list.util";
import type { GeoPoint } from "../building.document";
import { CAMPUS_MAP_REQUEST_TIMEOUT_MS, CAMPUS_MAP_URL, SKKU_CAMPUS_CODE } from "../building.constants";
import type { BilingualText, Campus } from "../building.types";
import type { SyncedCafeteria } from "./building-cafeteria.document";
import { skkuSisulListCafeteria, skkuSisulListResponse, type SkkuSisulListCafeteria } from "./building-cafeteria.schema";

/** QUIRK(skku): sisulList's business-kind code for a cafeteria. */
const CAFETERIA_BIZ_KIND = "0201";
const MAX_LOGGED_INVALID_ITEMS = 10;

type FacilityRow = Record<string, unknown> & { conspaceCd: unknown; bizKind: unknown };

@Injectable()
export class BuildingCafeteriaClient {
  async fetchCafeterias(campus: Campus): Promise<SyncedCafeteria[]> {
    const { data } = await axios.get<unknown>(CAMPUS_MAP_URL, {
      params: { mode: "sisulList", campusCd: SKKU_CAMPUS_CODE[campus] },
      timeout: CAMPUS_MAP_REQUEST_TIMEOUT_MS,
    });
    const parsed = skkuSisulListResponse.safeParse(data);
    if (!parsed.success) {
      throw new Error(`campusMap.do sisulList (${campus}) is not the expected shape: ${issuePaths(parsed.error)}`);
    }
    const cafeteriaRows = this.collectFacilityRows(parsed.data.buildItems).filter((row) => row.bizKind === CAFETERIA_BIZ_KIND);
    return this.parseCafeteriaRows(cafeteriaRows, campus).map((row) => this.toCafeteria(row, campus));
  }

  /** QUIRK(skku): rows sit two or three levels deep by category (`subBizList[].subList[]` or `subList[]`), so it walks the tree. */
  private collectFacilityRows(node: unknown, rows: FacilityRow[] = []): FacilityRow[] {
    if (Array.isArray(node)) {
      for (const child of node) this.collectFacilityRows(child, rows);
    } else if (typeof node === "object" && node !== null) {
      if ("conspaceCd" in node && "bizKind" in node) rows.push(node as FacilityRow);
      for (const child of Object.values(node)) this.collectFacilityRows(child, rows);
    }
    return rows;
  }

  private parseCafeteriaRows(rows: readonly FacilityRow[], campus: Campus): SkkuSisulListCafeteria[] {
    const { valid, invalid } = parseEach(rows, skkuSisulListCafeteria, (row, index) => {
      const { conspaceCd } = row as FacilityRow;
      return typeof conspaceCd === "string" && conspaceCd !== "" ? conspaceCd : `#${index}`;
    });
    if (invalid.length > 0) {
      logger.warn(
        {
          event: "building.cafeteria.payload_items_dropped",
          scope: campus,
          dropped: invalid.length,
          total: rows.length,
          invalid: invalid.slice(0, MAX_LOGGED_INVALID_ITEMS),
        },
        "SKKU sisulList cafeterias left out: they do not match the schema",
      );
    }
    return valid;
  }

  private toCafeteria(row: SkkuSisulListCafeteria, campus: Campus): SyncedCafeteria {
    return {
      _id: row.conspaceCd,
      kind: "cafeteria",
      campus,
      name: this.toBilingualText(row.bizNm, row.bizNmEng),
      buildNo: row.buildNo,
      buildingName: this.toBilingualText(row.buildNm, row.buildNmEng),
      floor: row.floorNm ? this.toBilingualText(row.floorNm, row.floorNmEng) : null,
      floorCode: row.floor || null,
      spaceCd: row.spaceCd ?? null,
      location: this.toLocation(row.latitude, row.longtitude),
    };
  }

  private toLocation(lat: number | undefined, lng: number | undefined): GeoPoint | null {
    if (lat === undefined || lng === undefined) return null;
    return { type: "Point", coordinates: [lng, lat] };
  }

  private toBilingualText(ko: string | undefined, en: string | undefined): BilingualText {
    return { ko: ko || "", en: en || "" };
  }
}
