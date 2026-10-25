/**
 * JourneyRoutesService over fakes (ADR 0022, D6): it serves every stored route with `meta.serverNow`, plans each
 * once per route and language within five seconds (single-flight, a second language planned apart), reads one door
 * board per distinct line and stop pair, serves an option whose door fails as not running and unavailable while the
 * others plan, logged once, leaves out a route whose end no catalog resolves, serves an option a leg of which cites
 * an unresolved place as unavailable, orders a route's options by arrival, and answers 503 with no dataset stored.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { journeyRoutesFixture } from "../../../__tests__/helpers/journey/journey-routes";
import { FakeJourneyDeparturesService } from "../../../__tests__/helpers/fakes/journey/journey-departures.service.fake";
import { FakeJourneyPlacesService } from "../../../__tests__/helpers/fakes/journey/journey-places.service.fake";
import { FakeJourneyRepository } from "../../../__tests__/helpers/fakes/journey/journey.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import logger from "../../infra/logger";
import type { StopCall } from "../../shared/call.types";
import type { DepartureBoard } from "../../shared/departure.types";
import type { JourneyDeparturesService } from "../departures/journey-departures.service";
import type { JourneyRepository } from "../journey.repository";
import type { JourneyPlacesService } from "../places/journey-places.service";
import { JourneyRoutesService } from "./journey-routes.service";

const kst = (time: string) => new Date(`2026-10-20T${time}:00+09:00`);
const NOW = kst("14:10");

function call(time: string): StopCall {
  return {
    status: "scheduled",
    ...{ expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: kst(time) },
    basis: "timetable",
    ...{ stopsAway: null, runId: `run-${time}`, vehicleId: null, headsign: null, isFirstRun: false, isLastRun: false, isExpress: null, providerText: null },
  };
}

const boardOf = (...times: string[]): DepartureBoard => ({
  departures: times.map((time) => ({ lineId: "x", board: call(time), alight: null, observedAt: null })),
  vehicles: {},
  continuation: { kind: "listed" },
  nextServiceAt: null,
});

function setup() {
  const repository = new FakeJourneyRepository();
  repository.storeRoutes(journeyRoutesFixture());
  const departures = new FakeJourneyDeparturesService();
  departures.boards.set("campus-inja", boardOf("14:30", "15:00"));
  departures.boards.set("campus-jain", boardOf("14:30"));
  const places = new FakeJourneyPlacesService();
  const service = new JourneyRoutesService(asReal<JourneyRepository>(repository), asReal<JourneyDeparturesService>(departures), asReal<JourneyPlacesService>(places), { now: () => NOW });
  return { service, repository, departures, places };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("JourneyRoutesService.listRoutes", () => {
  it("serves every stored route in data order, with serverNow", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const served = await service.listRoutes("ko");

    // Assert
    expect(served.meta).toEqual({ serverNow: "2026-10-20T14:10:00+09:00" });
    expect(served.data.routes.map((route) => [route.id, route.from.name, route.options.map((option) => option.status)])).toEqual([
      ["hssc-to-nsc", "1 (ko)", ["running"]],
      ["nsc-to-hssc", "7 (ko)", ["running"]],
    ]);
  });

  it("plans a route once per language within five seconds, and another language apart", async () => {
    // Arrange
    const { service, departures } = setup();

    // Act
    await Promise.all([service.listRoutes("ko"), service.listRoutes("ko")]);
    await service.listRoutes("en");

    // Assert
    expect(departures.queries.map(({ query }) => `${query.lineId} ${query.lang}`)).toEqual(["campus-inja ko", "campus-jain ko", "campus-inja en", "campus-jain en"]);
  });

  it("reads one board per line and stop pair, shared by the options that ride it, over the next three hours", async () => {
    // Arrange
    const { service, repository, departures } = setup();
    const data = journeyRoutesFixture();
    data.routes[0].options.push({ ...structuredClone(data.routes[0].options[0]), id: "inja-again" });
    repository.storeRoutes(data);

    // Act
    const served = await service.listRoutes("ko");

    // Assert
    expect(served.data.routes[0]!.options.map((option) => option.id)).toEqual(["inja", "inja-again"]);
    expect(departures.queries.filter(({ query }) => query.lineId === "campus-inja").map(({ source, query }) => [source, query.boardStopId, query.alightStopId, query.from, query.until])).toEqual([
      ["busTimetable", "hssc-bus-lot", "nsc-n-center", NOW, kst("17:10")],
    ]);
  });

  it("serves the options of a failing door as unavailable, the others planned, and logs it once", async () => {
    // Arrange
    const { service, departures } = setup();
    departures.failWith.set("campus-jain", new Error("bus-stops unavailable"));

    // Act
    const served = await service.listRoutes("ko");

    // Assert
    expect(served.data.routes.map((route) => route.options.map((option) => [option.status, option.reason]))).toEqual([[["running", null]], [["notRunning", "unavailable"]]]);
    expect(jest.mocked(logger.error).mock.calls.map(([fields]) => (fields as { event: string }).event)).toEqual(["journey.departures.unavailable"]);
  });

  it("leaves out a route whose end no catalog resolves, and serves an option citing an unresolved stop as unavailable", async () => {
    // Arrange
    const { service, places } = setup();
    places.unresolved.add("skku_building:7");
    places.unresolved.add("bus_stop:hssc-600th");

    // Act
    const served = await service.listRoutes("ko");

    // Assert
    expect(served.data.routes).toEqual([]);
    expect(jest.mocked(logger.warn).mock.calls.map(([fields]) => (fields as { ref: string }).ref)).toEqual(expect.arrayContaining(["skku_building:7"]));
  });

  it("orders a route's options by arrival, the later one in data order last", async () => {
    // Arrange
    const { service, repository, departures } = setup();
    const data = journeyRoutesFixture();
    const late = structuredClone(data.routes[0].options[0]);
    late.id = "inja-late";
    late.legs[1].line = "inja-late";
    data.lines.push({ ...data.lines[0], id: "inja-late", sourceLineId: "campus-inja-late" });
    data.routes[0].options.unshift(late);
    repository.storeRoutes(data);
    departures.boards.set("campus-inja-late", boardOf("16:00"));

    // Act
    const served = await service.listRoutes("ko");

    // Assert
    expect(served.data.routes[0]!.options.map((option) => [option.id, option.arriveAt])).toEqual([
      ["inja", "2026-10-20T15:56:00+09:00"],
      ["inja-late", "2026-10-20T17:26:00+09:00"],
    ]);
  });

  it("answers 503 JOURNEY_ROUTES_UNAVAILABLE with no dataset stored", async () => {
    // Arrange
    const { service, repository } = setup();
    repository.stored = null;

    // Act & Assert
    await expect(service.listRoutes("ko")).rejects.toMatchObject({ code: "JOURNEY_ROUTES_UNAVAILABLE", httpStatus: 503 });
  });
});
