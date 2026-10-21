/**
 * toHsscBus keeps the API row whole and adds what the realtime and station
 * routes read: the linear sequence as a string, the app's stop name (the API's
 * when unmapped), the event time in KST and the seconds there; and
 * toHsscFeedEventDoc renames a row's fields for the feed event log, keeping
 * get_date as received beside its parsed instant.
 */
import moment from "moment-timezone";
import { toHsscBus, toHsscFeedEventDoc } from "./bus-realtime-hssc.mapper";

const ROW = { line_no: "1", inout: "LEFT", stop_no: "3", seq: "6", stop_name: "농구장정류소", get_date: "2026-10-20 오전 9:59:30" };
const firstSeenAt = moment.tz("2026-10-20 09:59:30", "YYYY-MM-DD HH:mm:ss", "Asia/Seoul");

describe("toHsscBus", () => {
  it("keeps the row and adds the served fields", () => {
    // Act
    const bus = toHsscBus(ROW, { sequence: 2, firstSeenAt, dwellSeconds: 30 });

    // Assert
    expect(bus).toEqual({
      ...ROW,
      sequence: "2",
      stationName: "농구장 (셔틀버스정류소)",
      carNumber: "0000",
      eventDate: "2026-10-20 09:59:30",
      estimatedTime: 30,
      isLastBus: false,
    });
  });

  it("passes an unmapped stop name through", () => {
    // Act & Assert
    expect(toHsscBus({ ...ROW, stop_name: "새로운정류장" }, { sequence: 2, firstSeenAt, dwellSeconds: 0 }).stationName).toBe("새로운정류장");
  });

  it("passes a stop name that names an Object.prototype member through", () => {
    // Act & Assert
    expect(toHsscBus({ ...ROW, stop_name: "toString" }, { sequence: 2, firstSeenAt, dwellSeconds: 0 }).stationName).toBe("toString");
  });
});

describe("toHsscFeedEventDoc", () => {
  it("renames the row's fields and keeps get_date as received", () => {
    // Arrange
    const getDate = new Date("2026-10-20T00:59:30.000Z");
    const polledAt = new Date("2026-10-20T00:59:40.000Z");

    // Act
    const event = toHsscFeedEventDoc(ROW, { seq: 6, getDate }, polledAt);

    // Assert
    expect(event).toEqual({
      lineNo: "1",
      seq: 6,
      stopNo: "3",
      stopName: "농구장정류소",
      inout: "LEFT",
      getDate,
      rawGetDate: "2026-10-20 오전 9:59:30",
      polledAt,
    });
  });
});
