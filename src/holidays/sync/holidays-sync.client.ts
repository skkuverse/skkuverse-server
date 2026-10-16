import { Injectable } from "@nestjs/common";
import axios from "axios";
import type { z } from "zod";
import config from "../../infra/config";
import { issuePaths } from "../../shared/zod-list.util";
import { HolidaysSyncCalendarError } from "./holidays-sync.error";
import { gatewayError, restDeBody, restDeEnvelope, type restDeRow } from "./holidays-sync.schema";
import type { PublicHoliday } from "../holidays.types";

const REST_DE_INFO_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const REQUEST_TIMEOUT_MS = 10_000;
// WHY: a year lists about twenty days; one page of a hundred holds any year, and a shorter page rejects.
const ROWS_PER_PAGE = 100;
const SUCCESS_RESULT_CODE = "00";
const UNEXPECTED_SHAPE = "unexpected_shape";
const OK_STATUS = 200;

type RestDeRow = z.infer<typeof restDeRow>;

@Injectable()
export class HolidaysSyncClient {
  // QUIRK(data-go-kr): the service key travels in the query string, so a failure keeps only its status and code.
  async fetchYear(year: number): Promise<PublicHoliday[]> {
    let data: unknown;
    try {
      ({ data } = await axios.get<unknown>(REST_DE_INFO_URL, {
        params: { serviceKey: config.holidays.serviceKey, solYear: String(year), _type: "json", numOfRows: ROWS_PER_PAGE },
        timeout: REQUEST_TIMEOUT_MS,
      }));
    } catch (err: unknown) {
      throw this.toCalendarError(year, err);
    }
    return this.toHolidays(year, this.rowsOf(year, data));
  }

  private toCalendarError(year: number, err: unknown): HolidaysSyncCalendarError {
    if (!axios.isAxiosError(err)) return new HolidaysSyncCalendarError(`${year}: request failed`);
    const status = err.response?.status;
    const refused = gatewayError.safeParse(err.response?.data);
    const code = refused.success ? refused.data.OpenAPI_ServiceResponse.cmmMsgHeader.errMsg : err.code;
    return new HolidaysSyncCalendarError(status === undefined ? `${year}: request failed (${code ?? "no code"})` : `${year}: HTTP ${status}`, status, code);
  }

  private rowsOf(year: number, data: unknown): RestDeRow[] {
    const refused = gatewayError.safeParse(data);
    if (refused.success) {
      const { errMsg } = refused.data.OpenAPI_ServiceResponse.cmmMsgHeader;
      throw new HolidaysSyncCalendarError(`${year}: refused (${errMsg})`, OK_STATUS, errMsg);
    }
    const envelope = restDeEnvelope.safeParse(data);
    if (!envelope.success) throw this.shapeError(year, `not the expected envelope: ${issuePaths(envelope.error)}`);
    const { header, body } = envelope.data.response;
    if (header.resultCode !== SUCCESS_RESULT_CODE) {
      throw new HolidaysSyncCalendarError(`${year}: result code ${header.resultCode} (${header.resultMsg ?? "no message"})`, OK_STATUS, header.resultCode);
    }
    const parsedBody = restDeBody.safeParse(body);
    if (!parsedBody.success) throw this.shapeError(year, `not the expected body: ${issuePaths(parsedBody.error)}`);
    const { items, totalCount } = parsedBody.data;
    const rows = items === "" ? [] : [items.item].flat();
    if (rows.length !== totalCount) throw this.shapeError(year, `${rows.length} rows of ${totalCount}`);
    return rows;
  }

  private toHolidays(year: number, rows: readonly RestDeRow[]): PublicHoliday[] {
    const outsideYear = rows.filter((row) => Math.floor(row.locdate / 10_000) !== year);
    if (outsideYear.length > 0) throw this.shapeError(year, `${outsideYear.length} rows dated outside the year`);
    return rows
      .filter((row) => row.isHoliday === "Y")
      .map((row) => ({ date: this.toIsoDate(row.locdate), name: row.dateName }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private toIsoDate(locdate: number): string {
    const digits = String(locdate);
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  private shapeError(year: number, detail: string): HolidaysSyncCalendarError {
    return new HolidaysSyncCalendarError(`${year}: ${detail}`, OK_STATUS, UNEXPECTED_SHAPE);
  }
}
