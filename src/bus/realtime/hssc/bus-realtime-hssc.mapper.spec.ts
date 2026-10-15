/**
 * toHsscBus keeps the API row whole and adds what the realtime and station
 * routes read: the linear sequence as a string, the app's stop name (the API's
 * when unmapped), the event time in KST and the seconds there.
 */
import moment from "moment-timezone";
import { toHsscBus } from "./bus-realtime-hssc.mapper";

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
