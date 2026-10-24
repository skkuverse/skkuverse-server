/**
 * The GBIS seat rules: the poller calls only inside 7800's service window, 04:50 to 02:30 KST every day, so the
 * 1,000-call daily quota holds; a cached answer is served for at most 200 s after this server fetched it; a negative
 * remainSeatCnt is no information, never a seat count; resultCode 4 is GBIS's "no result"; and a data.go.kr refusal
 * of the key's spent daily quota is told apart, in the gateway's XML or JSON envelope; and any gateway refusal is read as
 * its returnReasonCode and message, errMsg unless it is the generic SERVICE ERROR, else returnAuthMsg.
 */
import { isFreshSeats, isInServiceWindow, isNoResult, isQuotaExceeded, toGatewayRefusal, toSeatsLeft } from "./bus-realtime-gbis.rules";

describe("isInServiceWindow", () => {
  it.each([
    ["04:49 KST, a minute before the window opens", "2026-10-23T19:49:00Z", false],
    ["04:50 KST, when it opens", "2026-10-23T19:50:00Z", true],
    ["04:51 KST", "2026-10-23T19:51:00Z", true],
    ["12:00 KST", "2026-10-24T03:00:00Z", true],
    ["23:59 KST", "2026-10-24T14:59:00Z", true],
    ["00:00 KST, past midnight", "2026-10-24T15:00:00Z", true],
    ["01:30 KST, the weekday last bus on its way to 호매실", "2026-10-24T16:30:00Z", true],
    ["02:29 KST, the window's last minute", "2026-10-24T17:29:00Z", true],
    ["02:30 KST, when it closes", "2026-10-24T17:30:00Z", false],
    ["02:31 KST", "2026-10-24T17:31:00Z", false],
    ["03:00 KST", "2026-10-24T18:00:00Z", false],
  ])("at %s answers %s", (_label, at, expected) => {
    // Act & Assert
    expect(isInServiceWindow(new Date(at))).toBe(expected);
  });

  it("reads the clock in KST, not UTC: 17:30Z is 02:30 KST, closed, though 17:30 UTC would be inside", () => {
    // Act & Assert
    expect(isInServiceWindow(new Date("2026-10-19T17:30:00Z"))).toBe(false);
    expect(isInServiceWindow(new Date("2026-10-19T07:30:00Z"))).toBe(true);
  });
});

describe("isFreshSeats", () => {
  const checkedAt = new Date("2026-10-24T11:22:50.000Z");
  const after = (ms: number) => new Date(checkedAt.getTime() + ms);

  it.each([
    ["at once", 0, true],
    ["one 90 s tick later", 90_000, true],
    ["a millisecond before 200 s", 199_999, true],
    ["at 200 s", 200_000, true],
    ["a millisecond past 200 s", 200_001, false],
    ["a minute before it was fetched (another host's clock)", -60_000, true],
  ])("is %s fresh: %s", (_label, ageMs, expected) => {
    // Act & Assert
    expect(isFreshSeats(checkedAt, after(ageMs))).toBe(expected);
  });
});

describe("toSeatsLeft", () => {
  it.each([
    [-1, null],
    [0, 0],
    [1, 1],
    [70, 70],
  ])("serves remainSeatCnt %s as %s", (remainSeatCnt, expected) => {
    // Act & Assert
    expect(toSeatsLeft(remainSeatCnt)).toBe(expected);
  });
});

describe("isNoResult", () => {
  it.each([
    [0, false],
    [3, false],
    [4, true],
    [5, false],
  ])("resultCode %s: %s", (resultCode, expected) => {
    // Act & Assert
    expect(isNoResult(resultCode)).toBe(expected);
  });
});

describe("toGatewayRefusal", () => {
  it.each([
    [
      "the XML envelope, its generic errMsg giving way to returnAuthMsg",
      "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>23</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
      { code: "23", message: "LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR" },
    ],
    [
      "the JSON envelope, its specific errMsg kept (captured 2026-10-24 without a key)",
      { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NULL", returnAuthMsg: "서비스 접근거부", returnReasonCode: "20" } } },
      { code: "20", message: "SERVICE_KEY_IS_NULL" },
    ],
    ["the JSON envelope with errMsg only", { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "DEADLINE_HAS_EXPIRED_ERROR", returnReasonCode: "31" } } }, { code: "31", message: "DEADLINE_HAS_EXPIRED_ERROR" }],
    ["XML without a reason code", "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>", null],
    ["GBIS's own answer", { response: { msgHeader: { resultCode: 0 }, msgBody: { busLocationList: [] } } }, null],
    ["an HTML page", "<html>404</html>", null],
    ["nothing", undefined, null],
  ])("reads %s", (_label, body, expected) => {
    // Act & Assert
    expect(toGatewayRefusal(body)).toEqual(expected);
  });
});

describe("isQuotaExceeded", () => {
  it.each([
    [
      "the gateway's XML refusal",
      "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
      true,
    ],
    ["the gateway's JSON refusal", { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE ERROR", returnAuthMsg: "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR", returnReasonCode: "22" } } }, true],
    ["the per-second limit, code 23", { OpenAPI_ServiceResponse: { cmmMsgHeader: { returnAuthMsg: "LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR", returnReasonCode: "23" } } }, false],
    ["a missing key, code 20", { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NULL", returnAuthMsg: "서비스 접근거부", returnReasonCode: "20" } } }, false],
    ["GBIS's own answer", { response: { msgHeader: { resultCode: 0 }, msgBody: { busLocationList: [] } } }, false],
    ["nothing", undefined, false],
  ])("%s: %s", (_label, body, expected) => {
    // Act & Assert
    expect(isQuotaExceeded(body)).toBe(expected);
  });
});
