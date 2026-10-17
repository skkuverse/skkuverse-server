/**
 * BusRealtimeArrivalService.toArrivals, the door the realtime group reads a
 * station's arrivals through: a bus is listed when TOPIS gave it a text,
 * first bus first, each through the arrival rules with the route's seat count.
 */
import { jongroArrivalBus, noArrivalBus } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { BusRealtimeArrivalService } from "./bus-realtime-arrival.service";

describe("BusRealtimeArrivalService.toArrivals", () => {
  it("lists both buses, first bus first", () => {
    // Arrange
    const buses = [
      jongroArrivalBus({ arrmsg: "곧 도착", traTime: 112, staOrd: 15, sectOrd: 15 }),
      jongroArrivalBus({ arrmsg: "7분50초후[4번째 전]", traTime: 470, staOrd: 15, sectOrd: 11, plainNo: "서울70사5535" }),
    ];

    // Act
    const arrivals = new BusRealtimeArrivalService().toArrivals(buses, 18);

    // Assert
    expect(arrivals.map((arrival) => [arrival.message, arrival.state, arrival.minutes, arrival.stopsAway, arrival.carNumber])).toEqual([
      ["곧 도착", "arriving", null, 0, "5537"],
      ["7분50초후[4번째 전]", "running", 8, 4, "5535"],
    ]);
  });

  it("leaves out a second bus with no text", () => {
    // Arrange
    const buses = [jongroArrivalBus({ arrmsg: "3분12초후[2번째 전]", traTime: 192 }), noArrivalBus({ arrmsg: "" })];

    // Act
    const arrivals = new BusRealtimeArrivalService().toArrivals(buses, 18);

    // Assert
    expect(arrivals.map((arrival) => arrival.message)).toEqual(["3분12초후[2번째 전]"]);
  });

  it("judges crowding against the seat count it is given", () => {
    // Arrange
    const buses = [jongroArrivalBus({ rerideDiv: 2, rerideNum: 20 })];

    // Act
    const [onEighteen, onTwenty] = [18, 20].map((seatCount) => new BusRealtimeArrivalService().toArrivals(buses, seatCount)[0]);

    // Assert
    expect([onEighteen!.crowding, onTwenty!.crowding]).toEqual(["normal", "relaxed"]);
  });

  it("lists nothing when neither bus has a text", () => {
    // Act & Assert
    expect(new BusRealtimeArrivalService().toArrivals([noArrivalBus(), noArrivalBus()], 18)).toEqual([]);
  });
});
