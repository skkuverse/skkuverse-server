/**
 * BusRealtimeGbisService over a scripted GBIS client and an in-memory bus_seats. A tick inside 7800's service window
 * asks GBIS once and replaces the route's seats with the answer and when it came; outside the window it calls
 * nothing and writes nothing, and a failed call or write rejects with nothing written (pollers report by rejecting).
 * The read the live route joins: each vehicle's seats left, by vehicle id, from an answer at most 200 s old; an older
 * answer, none, a vehicle GBIS did not know, and every route but a regional one (no read at all) give no seats, and a
 * bus_seats read that fails gives none too, logging `bus.gbis.read_failed` at most once a minute, so it never fails
 * the live answer.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeBusRealtimeGbisClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-gbis.client.fake";
import { FakeBusRealtimeGbisRepository } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-gbis.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import logger from "../../../infra/logger";
import { JONGRO_ROUTES, REGIONAL_ROUTES } from "../../bus.constants";
import type { BusRealtimeGbisClient } from "./bus-realtime-gbis.client";
import type { BusRealtimeGbisRepository } from "./bus-realtime-gbis.repository";
import { BusRealtimeGbisService } from "./bus-realtime-gbis.service";

const ROUTE_7800 = REGIONAL_ROUTES.find((route) => route.code === "7800")!;
// 20:22:50 KST on Saturday 2026-10-24, inside the window.
const IN_SERVICE = new Date("2026-10-24T11:22:50.000Z");
// 03:00 KST on Sunday, outside it.
const OVERNIGHT = new Date("2026-10-24T18:00:00.000Z");
const SEATS = [
  { vehicleId: "200010839", seatsLeft: 41 },
  { vehicleId: "200011684", seatsLeft: 0 },
  { vehicleId: "233000041", seatsLeft: null },
];

function setUp(at: Date) {
  const client = new FakeBusRealtimeGbisClient();
  const repository = new FakeBusRealtimeGbisRepository();
  let now = at;
  const clock = { now: () => now };
  const service = new BusRealtimeGbisService(asReal<BusRealtimeGbisClient>(client), asReal<BusRealtimeGbisRepository>(repository), clock);
  return { client, repository, service, setNow: (next: Date) => (now = next) };
}

describe("BusRealtimeGbisService.refresh", () => {
  it("asks GBIS for the route inside the window and stores its answer under the route id, when it came", async () => {
    // Arrange
    const { client, repository, service } = setUp(IN_SERVICE);
    client.seats = SEATS;

    // Act
    await service.refresh(ROUTE_7800);

    // Assert
    expect(client.routes).toEqual([ROUTE_7800]);
    expect(repository.seatsByRouteId.get("gyeonggi7800")).toEqual({ _id: "gyeonggi7800", seats: SEATS, checkedAt: IN_SERVICE });
  });

  it("stores no bus as an empty answer, so the read serves no seats rather than an older answer's", async () => {
    // Arrange
    const { repository, service } = setUp(IN_SERVICE);
    repository.seatsByRouteId.set("gyeonggi7800", { _id: "gyeonggi7800", seats: SEATS, checkedAt: new Date(IN_SERVICE.getTime() - 90_000) });

    // Act
    await service.refresh(ROUTE_7800);

    // Assert
    expect(repository.seatsByRouteId.get("gyeonggi7800")).toEqual({ _id: "gyeonggi7800", seats: [], checkedAt: IN_SERVICE });
  });

  it("calls nothing and writes nothing outside the window", async () => {
    // Arrange
    const { client, repository, service } = setUp(OVERNIGHT);

    // Act
    await service.refresh(ROUTE_7800);

    // Assert
    expect(client.routes).toEqual([]);
    expect(repository.seatsByRouteId.size).toBe(0);
  });

  it("rejects with the client's error and writes nothing when GBIS fails", async () => {
    // Arrange
    const { client, repository, service } = setUp(IN_SERVICE);
    client.failWith = new Error("GBIS daily quota exceeded (7800 seats)");

    // Act & Assert
    await expect(service.refresh(ROUTE_7800)).rejects.toThrow("GBIS daily quota exceeded");
    expect(repository.seatsByRouteId.size).toBe(0);
  });

  it("rejects when the write fails", async () => {
    // Arrange
    const { client, repository, service } = setUp(IN_SERVICE);
    client.seats = SEATS;
    repository.failWith = new Error("atlas down");

    // Act & Assert
    await expect(service.refresh(ROUTE_7800)).rejects.toThrow("atlas down");
  });
});

describe("BusRealtimeGbisService.findSeatsLeft", () => {
  const stored = (ageMs: number) => ({ _id: "gyeonggi7800", seats: SEATS, checkedAt: new Date(IN_SERVICE.getTime() - ageMs) });

  it("answers each vehicle's seats left by id from a fresh answer, leaving out a vehicle GBIS did not know", async () => {
    // Arrange
    const { repository, service } = setUp(IN_SERVICE);
    repository.seatsByRouteId.set("gyeonggi7800", stored(90_000));

    // Act
    const seatsLeftById = await service.findSeatsLeft("gyeonggi7800");

    // Assert
    expect([...seatsLeftById]).toEqual([
      ["200010839", 41],
      ["200011684", 0],
    ]);
  });

  it.each([
    ["at 200 s", 200_000, 2],
    ["a millisecond past 200 s", 200_001, 0],
  ])("serves an answer %s old with %s vehicles", async (_label, ageMs, size) => {
    // Arrange
    const { repository, service } = setUp(IN_SERVICE);
    repository.seatsByRouteId.set("gyeonggi7800", stored(ageMs));

    // Act & Assert
    expect((await service.findSeatsLeft("gyeonggi7800")).size).toBe(size);
  });

  it("serves no seats and logs when bus_seats cannot be read, once a minute, counting the lines it left out", async () => {
    // Arrange
    jest.mocked(logger.warn).mockClear();
    const { repository, service, setNow } = setUp(IN_SERVICE);
    const timeout = new Error("operation exceeded time limit");
    repository.readFailWith = timeout;

    // Act
    const answers = [await service.findSeatsLeft("gyeonggi7800"), await service.findSeatsLeft("gyeonggi7800")];
    setNow(new Date(IN_SERVICE.getTime() + 60_000));
    answers.push(await service.findSeatsLeft("gyeonggi7800"));

    // Assert
    expect(answers.map((seatsLeftById) => seatsLeftById.size)).toEqual([0, 0, 0]);
    const lines = jest.mocked(logger.warn).mock.calls.map(([fields]) => fields);
    expect(lines).toEqual([
      { event: "bus.gbis.read_failed", routeId: "gyeonggi7800", err: timeout, suppressed: 0 },
      { event: "bus.gbis.read_failed", routeId: "gyeonggi7800", err: timeout, suppressed: 1 },
    ]);
  });

  it("answers no seats when nothing is stored", async () => {
    // Arrange
    const { service } = setUp(IN_SERVICE);

    // Act & Assert
    expect((await service.findSeatsLeft("gyeonggi7800")).size).toBe(0);
  });

  it("reads nothing for a Jongno route, which GBIS does not serve", async () => {
    // Arrange
    const { repository, service } = setUp(IN_SERVICE);

    // Act
    const answers = await Promise.all(JONGRO_ROUTES.map((route) => service.findSeatsLeft(route.id)));

    // Assert
    expect(answers.map((seatsLeftById) => seatsLeftById.size)).toEqual([0, 0, 0]);
    expect(repository.reads).toBe(0);
  });
});
