/**
 * BusRealtimeArrivalService.toArrivals, the door the realtime group reads a
 * station's arrivals through: a bus is listed when TOPIS gave it a text,
 * first bus first, each through the arrival rules with the route's seat count.
 * seatCountOf answers that seat count from the stored `jongro-route-attributes`
 * (ADR 0013, D6), and a 503 for a route the revision lacks.
 */
import { jongroArrivalBus, noArrivalBus } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { routeAttributesFixture, storedRouteAttributesRepository, storedRouteAttributesService } from "../../../../__tests__/helpers/bus/route-attributes";
import { BusRealtimeArrivalService } from "./bus-realtime-arrival.service";

const arrivalService = () => new BusRealtimeArrivalService(storedRouteAttributesService());

describe("BusRealtimeArrivalService.toArrivals", () => {
  it("lists both buses, first bus first", () => {
    // Arrange
    const buses = [
      jongroArrivalBus({ arrmsg: "곧 도착", traTime: 112, staOrd: 15, sectOrd: 15 }),
      jongroArrivalBus({ arrmsg: "7분50초후[4번째 전]", traTime: 470, staOrd: 15, sectOrd: 11, plainNo: "서울70사5535" }),
    ];

    // Act
    const arrivals = arrivalService().toArrivals(buses, 18);

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
    const arrivals = arrivalService().toArrivals(buses, 18);

    // Assert
    expect(arrivals.map((arrival) => arrival.message)).toEqual(["3분12초후[2번째 전]"]);
  });

  it("judges crowding against the seat count it is given", () => {
    // Arrange
    const buses = [jongroArrivalBus({ rerideDiv: 2, rerideNum: 20 })];

    // Act
    const [onEighteen, onTwenty] = [18, 20].map((seatCount) => arrivalService().toArrivals(buses, seatCount)[0]);

    // Assert
    expect([onEighteen!.crowding, onTwenty!.crowding]).toEqual(["normal", "relaxed"]);
  });

  it("lists nothing when neither bus has a text", () => {
    // Act & Assert
    expect(arrivalService().toArrivals([noArrivalBus(), noArrivalBus()], 18)).toEqual([]);
  });
});

describe("BusRealtimeArrivalService.toTimedArrivals", () => {
  it("pairs each bus with a text with its arrival and the seconds its time comes to", () => {
    // Arrange
    const first = jongroArrivalBus({ arrmsg: "곧 도착", traTime: 40, staOrd: 15, sectOrd: 15 });
    const buses = [first, noArrivalBus({ arrmsg: "" })];

    // Act
    const timed = arrivalService().toTimedArrivals(buses, 18);

    // Assert
    expect(timed).toEqual([{ bus: first, arrival: arrivalService().toArrivals([first], 18)[0], travelSeconds: 40 }]);
  });
});

describe("BusRealtimeArrivalService.seatCountOf", () => {
  it("Crowding follows the stored seat count: answers jongro07's stored 18", async () => {
    // Act & Assert
    await expect(arrivalService().seatCountOf("jongro07")).resolves.toBe(18);
  });

  it("answers a raised seat count stored for jongro07", async () => {
    // Arrange
    const raised = routeAttributesFixture();
    raised.routes.jongro07 = { ...raised.routes.jongro07!, seatCount: 25 };
    const service = new BusRealtimeArrivalService(storedRouteAttributesService(storedRouteAttributesRepository(raised)));

    // Act & Assert
    await expect(service.seatCountOf("jongro07")).resolves.toBe(25);
  });

  it("rejects with JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE for a route the stored revision lacks", async () => {
    // Arrange
    const lacking = routeAttributesFixture();
    delete lacking.routes.jongro08;
    const service = new BusRealtimeArrivalService(storedRouteAttributesService(storedRouteAttributesRepository(lacking)));

    // Act & Assert
    await expect(service.seatCountOf("jongro08")).rejects.toMatchObject({ code: "JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", httpStatus: 503 });
  });
});
