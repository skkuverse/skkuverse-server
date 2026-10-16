/**
 * HolidaysClient against getRestDeInfo as it answered on 2026-10-16 (captured
 * fixtures in __tests__/nest/holidays/fixtures/, see each file's `_about`).
 * What it guards: one request per year with the service key as a query
 * parameter; the translation of each `isHoliday` `Y` row into a dated,
 * named holiday, substitute, temporary and election-day holidays included;
 * the payload's quirks (one row as an object, no rows as an empty string);
 * and every failure (an HTTP status, a timeout, a non-`00` result code, the
 * gateway's error envelope, a body of another shape) rejecting with a
 * HolidaysCalendarError that names the source, status and code and carries
 * neither the URL nor the key.
 */
import fs from "fs";
import path from "path";
import axios from "axios";

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { ...actual, __esModule: true, default: { ...actual.default, get: jest.fn() }, isAxiosError: actual.isAxiosError };
});
const mockedGet = axios.get as jest.Mock;

import config from "../infra/config";
import { HolidaysCalendarError } from "./holidays.error";
import { HolidaysClient } from "./holidays.client";

type Payload = Record<string, unknown>;

const ENDPOINT = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const fixture = (name: string): Payload =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../__tests__/nest/holidays/fixtures", name), "utf8"));
const YEAR_2024 = fixture("getrestdeinfo-2024.json");
const YEAR_2026 = fixture("getrestdeinfo-2026.json");
const ONE_ROW = fixture("getrestdeinfo-2026-07.json");
const NO_ROWS = fixture("getrestdeinfo-2026-04.json");
const UNREGISTERED_KEY = fixture("getrestdeinfo-unregistered-key.json");

const client = new HolidaysClient();
const respond = (data: unknown) => mockedGet.mockResolvedValue({ status: 200, data });

/** An axios error as axios builds one: its config holds the request URL and the key. */
function axiosError(fields: { status?: number; code?: string; data?: unknown }): Error {
  const requestConfig = { url: ENDPOINT, params: { serviceKey: config.holidays.serviceKey, solYear: "2026" } };
  const response = fields.status === undefined ? undefined : { status: fields.status, data: fields.data ?? "", config: requestConfig, headers: {}, statusText: "" };
  return new axios.AxiosError("boom", fields.code, requestConfig as never, {}, response as never);
}

async function failureOf(year: number): Promise<HolidaysCalendarError> {
  return (await client.fetchYear(year).catch((err: unknown) => err)) as HolidaysCalendarError;
}

function leaksNothing(err: Error): void {
  const serialized = JSON.stringify(err) + err.message + String(err.stack);
  expect(serialized).not.toContain(config.holidays.serviceKey);
  expect(serialized).not.toContain("apis.data.go.kr");
  expect(serialized).not.toContain("serviceKey");
}

/** A deep copy of a captured payload, with `edit` applied to its rows. */
function withRows(payload: Payload, edit: (rows: Payload[]) => Payload[]): Payload {
  const copy = JSON.parse(JSON.stringify(payload)) as { response: { body: { items: { item: Payload[] }; totalCount: number } } };
  copy.response.body.items.item = edit(copy.response.body.items.item);
  copy.response.body.totalCount = copy.response.body.items.item.length;
  return copy as unknown as Payload;
}

beforeEach(() => {
  mockedGet.mockReset();
});

describe("HolidaysClient.fetchYear", () => {
  it("asks getRestDeInfo for one year as JSON, with the service key as a query parameter", async () => {
    // Arrange
    respond(YEAR_2026);

    // Act
    await client.fetchYear(2026);

    // Assert
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(ENDPOINT, {
      params: { serviceKey: config.holidays.serviceKey, solYear: "2026", _type: "json", numOfRows: 100 },
      timeout: 10_000,
    });
  });

  it("reads all 22 holidays of 2026, the substitute and election-day holidays included, in date order", async () => {
    // Arrange
    respond(YEAR_2026);

    // Act
    const holidays = await client.fetchYear(2026);

    // Assert
    expect(holidays).toHaveLength(22);
    expect(holidays[0]).toEqual({ date: "2026-01-01", name: "1월1일" });
    expect(holidays).toContainEqual({ date: "2026-03-02", name: "대체공휴일(삼일절)" });
    expect(holidays).toContainEqual({ date: "2026-06-03", name: "전국동시지방선거" });
    expect(holidays.at(-1)).toEqual({ date: "2026-12-25", name: "기독탄신일" });
    expect(holidays.map((h) => h.date)).toEqual([...holidays.map((h) => h.date)].sort());
  });

  it("reads all 19 holidays of 2024, the temporary holiday and the election day included", async () => {
    // Arrange
    respond(YEAR_2024);

    // Act
    const holidays = await client.fetchYear(2024);

    // Assert
    expect(holidays).toHaveLength(19);
    expect(holidays).toContainEqual({ date: "2024-02-12", name: "대체공휴일(설날)" });
    expect(holidays).toContainEqual({ date: "2024-04-10", name: "국회의원선거" });
    expect(holidays).toContainEqual({ date: "2024-05-06", name: "대체공휴일(어린이날)" });
    expect(holidays).toContainEqual({ date: "2024-10-01", name: "임시공휴일" });
  });

  it("reads a single row, which the calendar sends as an object instead of an array", async () => {
    // Arrange
    respond(ONE_ROW);

    // Act & Assert
    await expect(client.fetchYear(2026)).resolves.toEqual([{ date: "2026-07-17", name: "제헌절" }]);
  });

  it("reads no rows, which the calendar sends as an empty string, as no holidays", async () => {
    // Arrange
    respond(NO_ROWS);

    // Act & Assert
    await expect(client.fetchYear(2026)).resolves.toEqual([]);
  });

  it("leaves out a row whose isHoliday is not Y", async () => {
    // Arrange
    respond(withRows(YEAR_2026, (rows) => rows.map((row) => (row.locdate === 20260603 ? { ...row, isHoliday: "N" } : row))));

    // Act
    const holidays = await client.fetchYear(2026);

    // Assert
    expect(holidays).toHaveLength(21);
    expect(holidays.map((h) => h.date)).not.toContain("2026-06-03");
  });
});

describe("HolidaysClient.fetchYear on a failure", () => {
  it("Calendar error: a 500 names the source and status, and serializes without the URL or the key", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 500, code: "ERR_BAD_RESPONSE", data: "<html>error</html>" }));

    // Act
    const err = await failureOf(2026);

    // Assert
    expect(err).toBeInstanceOf(HolidaysCalendarError);
    expect(err).toMatchObject({ source: "getRestDeInfo", status: 500, code: "ERR_BAD_RESPONSE" });
    expect(err.cause).toBeUndefined();
    leaksNothing(err);
  });

  it("a timeout carries its code and no status", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ code: "ECONNABORTED" }));

    // Act
    const err = await failureOf(2026);

    // Assert
    expect(err).toBeInstanceOf(HolidaysCalendarError);
    expect(err).toMatchObject({ source: "getRestDeInfo", code: "ECONNABORTED" });
    expect(err.status).toBeUndefined();
    leaksNothing(err);
  });

  it("an unregistered key answered with 403 carries the gateway's errMsg as its code", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 403, code: "ERR_BAD_REQUEST", data: UNREGISTERED_KEY }));

    // Act
    const err = await failureOf(2026);

    // Assert
    expect(err).toMatchObject({ source: "getRestDeInfo", status: 403, code: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" });
    leaksNothing(err);
  });

  it("the gateway's error envelope answered with 200 rejects with its errMsg", async () => {
    // Arrange
    respond(UNREGISTERED_KEY);

    // Act
    const err = await failureOf(2026);

    // Assert
    expect(err).toBeInstanceOf(HolidaysCalendarError);
    expect(err).toMatchObject({ status: 200, code: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" });
  });

  it("a result code other than 00 rejects with that code", async () => {
    // Arrange
    respond({ response: { header: { resultCode: "22", resultMsg: "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR." } } });

    // Act
    const err = await failureOf(2026);

    // Assert
    expect(err).toBeInstanceOf(HolidaysCalendarError);
    expect(err).toMatchObject({ status: 200, code: "22" });
  });

  it.each([
    ["an XML body", '<?xml version="1.0"?><response><header><resultCode>00</resultCode></header></response>'],
    ["a body without rows", { response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." } } }],
    ["a row without a name", withRows(YEAR_2026, (rows) => rows.map((row) => (row.locdate === 20260302 ? { ...row, dateName: "" } : row)))],
    ["a row with a date that is not YYYYMMDD", withRows(YEAR_2026, (rows) => [...rows, { ...rows[0], locdate: 2026101 }])],
  ])("%s rejects as an unexpected shape", async (_label, data) => {
    // Arrange
    respond(data);

    // Act
    const err = await failureOf(2026);

    // Assert
    expect(err).toBeInstanceOf(HolidaysCalendarError);
    expect(err).toMatchObject({ status: 200, code: "unexpected_shape" });
  });

  it("fewer rows than totalCount (a truncated page) rejects", async () => {
    // Arrange
    const truncated = withRows(YEAR_2026, (rows) => rows.slice(1)) as { response: { body: { totalCount: number } } };
    truncated.response.body.totalCount = 22;
    respond(truncated);

    // Act
    const err = await failureOf(2026);

    // Assert
    expect(err).toMatchObject({ status: 200, code: "unexpected_shape" });
  });

  it("rows of another year than the one asked for reject", async () => {
    // Arrange
    respond(YEAR_2024);

    // Act
    const err = await failureOf(2026);

    // Assert
    expect(err).toMatchObject({ status: 200, code: "unexpected_shape" });
  });
});
