/**
 * The schemas CalendarHolidaySyncClient reads getRestDeInfo through, checked against the
 * 2026-10-16 and 17 captures (__tests__/nest/calendar/fixtures/, see each file's
 * `_about`). What it guards: every captured envelope, body and row passes;
 * a row or body missing any field of its shape fails at that field's path;
 * the body takes `items` as "" (no rows), as one row object or as an array;
 * a row's name is not empty, its isHoliday is Y or N, and its locdate is an
 * eight-digit date; the gateway's refusal keeps its errMsg, reason code and
 * message. How the client turns a failed parse into an error is
 * calendar-holiday-sync.client.spec.ts's.
 */
import fs from "fs";
import path from "path";
import { gatewayError, restDeBody, restDeEnvelope, restDeRow } from "./calendar-holiday-sync.schema";

type Payload = Record<string, unknown>;

const fixture = (name: string): Payload =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/calendar/fixtures", name), "utf8"));
const bodyOf = (payload: Payload): Payload => (payload.response as { body: Payload }).body;
const YEAR_2026 = fixture("getrestdeinfo-2026.json");
const ONE_ROW = fixture("getrestdeinfo-2026-07.json");
const NO_ROWS = fixture("getrestdeinfo-2026-04.json");
const UNREGISTERED_KEY = fixture("getrestdeinfo-unregistered-key.json");
const REFUSED_HEADER = fixture("getrestdeinfo-refused-header.json");
const ROWS = (bodyOf(YEAR_2026).items as { item: Payload[] }).item;
const [ROW] = ROWS as [Payload];

function without(payload: Payload, key: string): Payload {
  const copy = { ...payload };
  delete copy[key];
  return copy;
}

describe("restDeEnvelope", () => {
  it.each([
    ["a year", YEAR_2026],
    ["one row", ONE_ROW],
    ["no rows", NO_ROWS],
  ])("passes the captured envelope of %s", (_label, payload) => {
    // Act & Assert
    expect(restDeEnvelope.safeParse(payload).success).toBe(true);
  });

  it.each(Object.keys(restDeEnvelope.shape))("fails without %s", (key) => {
    // Act
    const parsed = restDeEnvelope.safeParse(without(YEAR_2026, key));

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });

  it("fails on the gateway's error envelope", () => {
    // Act & Assert
    expect(restDeEnvelope.safeParse(UNREGISTERED_KEY).success).toBe(false);
  });
});

describe("restDeBody", () => {
  it.each([
    ["a year", YEAR_2026],
    ["one row", ONE_ROW],
    ["no rows", NO_ROWS],
  ])("passes the captured body of %s", (_label, payload) => {
    // Act & Assert
    expect(restDeBody.safeParse(bodyOf(payload)).success).toBe(true);
  });

  it.each(Object.keys(restDeBody.shape))("fails without %s", (key) => {
    // Act
    const parsed = restDeBody.safeParse(without(bodyOf(YEAR_2026), key));

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });

  it("fails on items that are neither empty, one row nor rows", () => {
    // Act & Assert
    expect(restDeBody.safeParse({ ...bodyOf(YEAR_2026), items: "none" }).success).toBe(false);
  });
});

describe("restDeRow", () => {
  it("passes every captured row", () => {
    // Act & Assert
    expect(ROWS.every((row) => restDeRow.safeParse(row).success)).toBe(true);
  });

  it.each(Object.keys(restDeRow.shape))("fails without %s", (key) => {
    // Act
    const parsed = restDeRow.safeParse(without(ROW, key));

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });

  it.each([
    ["an empty name", { dateName: "" }],
    ["an isHoliday other than Y or N", { isHoliday: "y" }],
    ["a seven-digit locdate", { locdate: 2026101 }],
    ["a nine-digit locdate", { locdate: 202601011 }],
    ["a locdate as a string", { locdate: "20260101" }],
  ])("fails on %s", (_label, edit) => {
    // Act & Assert
    expect(restDeRow.safeParse({ ...ROW, ...edit }).success).toBe(false);
  });

  it.each([10000101, 99991231])("passes the locdate %s at a bound", (locdate) => {
    // Act & Assert
    expect(restDeRow.safeParse({ ...ROW, locdate }).success).toBe(true);
  });
});

describe("gatewayError", () => {
  it("passes the captured refusal of an unregistered key", () => {
    // Act & Assert
    expect(gatewayError.safeParse(UNREGISTERED_KEY).success).toBe(true);
  });

  it("reads the reason code and message of the captured refusal of a header", () => {
    // Act
    const parsed = gatewayError.parse(REFUSED_HEADER);

    // Assert
    expect(parsed.OpenAPI_ServiceResponse.cmmMsgHeader).toEqual({
      errMsg: "INVALID_REQUEST_PARAMETER_ERROR",
      returnAuthMsg: "잘못된 요청 파라미터 에러",
      returnReasonCode: "10",
    });
  });

  it("passes a refusal with an errMsg alone", () => {
    // Act & Assert
    expect(gatewayError.safeParse({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE ERROR" } } }).success).toBe(true);
  });

  it.each(Object.keys(gatewayError.shape))("fails without %s", (key) => {
    // Act & Assert
    expect(gatewayError.safeParse(without(UNREGISTERED_KEY, key)).success).toBe(false);
  });

  it("fails on a successful envelope", () => {
    // Act & Assert
    expect(gatewayError.safeParse(YEAR_2026).success).toBe(false);
  });
});
