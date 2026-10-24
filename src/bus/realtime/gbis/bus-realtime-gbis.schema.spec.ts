/**
 * The GBIS location schemas: the 2026-10-24 capture of 7800 passes whole, a bus missing any field the client reads
 * fails, and an answer without msgBody (GBIS's "no result") or with one bus as an object still parses.
 */
import capture from "../../../../__tests__/nest/bus/fixtures/gbis-location-7800.json";
import { gbisBusLocation, gbisLocationAnswer } from "./bus-realtime-gbis.schema";

const firstBus = capture.response.msgBody.busLocationList[0]!;

describe("gbisLocationAnswer", () => {
  it("passes the captured answer, all 14 buses", () => {
    // Act
    const parsed = gbisLocationAnswer.safeParse(capture);

    // Assert
    expect(parsed.success).toBe(true);
    expect([parsed.data?.response.msgBody?.busLocationList].flat()).toHaveLength(14);
  });

  it("passes a no-result answer without msgBody", () => {
    // Act & Assert
    expect(gbisLocationAnswer.safeParse({ response: { msgHeader: { resultCode: 4, resultMessage: "결과가 존재하지 않습니다." } } }).success).toBe(true);
  });

  it("passes one bus answered as an object", () => {
    // Act & Assert
    expect(gbisLocationAnswer.safeParse({ response: { msgHeader: { resultCode: 0 }, msgBody: { busLocationList: firstBus } } }).success).toBe(true);
  });

  it("fails an answer without its header", () => {
    // Act & Assert
    expect(gbisLocationAnswer.safeParse({ response: { msgBody: capture.response.msgBody } }).success).toBe(false);
  });
});

describe("gbisBusLocation", () => {
  it.each(Object.keys(gbisBusLocation.shape))("fails a captured bus without %s", (field) => {
    // Arrange
    const rest: Record<string, unknown> = { ...firstBus };
    delete rest[field];

    // Act & Assert
    expect(gbisBusLocation.safeParse(rest).success).toBe(false);
  });

  it("fails a vehId sent as text", () => {
    // Act & Assert
    expect(gbisBusLocation.safeParse({ ...firstBus, vehId: String(firstBus.vehId) }).success).toBe(false);
  });
});
