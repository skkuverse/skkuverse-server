/**
 * The lane config as the boot loads it: the committed bus-lane.json checked against the sequences the app estimates.
 * The check runs against our own config, so each rejection here is a deploy that must not start, and it names every
 * issue at once: a malformed corridor, a strategy that does not exist and a sequence that is not estimated.
 */
import { toEtaSequences } from "../bus-eta.rules";
import { BusStopsService } from "../../stops/bus-stops.service";
import { loadLaneConfig, readLaneConfig } from "./bus-eta-lane.config";
import { strategyOf } from "./bus-eta-lane.rules";

const stops = new BusStopsService();
const estimated = toEtaSequences(stops.catalog(), stops.etaOptIns());

const committed: Record<string, unknown> = require("./bus-lane.json");

const copy = (): Record<string, unknown> => JSON.parse(JSON.stringify(committed));

/** The message parseConfigFile throws, or "" when the load passes. */
function loadError(raw: unknown): string {
  try {
    loadLaneConfig(raw, estimated);
    return "";
  } catch (err) {
    return (err as Error).message;
  }
}

describe("readLaneConfig", () => {
  it("loads the committed file against the estimated sequences, the shuttle between campuses on the bus lane", () => {
    // Act
    const lane = readLaneConfig(estimated);

    // Assert
    expect(estimated.map((s) => [s.serviceId, s.routeType, strategyOf(lane.strategies, s)])).toEqual([
      ["campus-inja", "regular", { strategy: "busLane", direction: "southbound" }],
      ["campus-inja", "hakbu", { strategy: "busLane", direction: "southbound" }],
      ["campus-jain", "regular", { strategy: "busLane", direction: "northbound" }],
      ["campus-jain", "hakbu", { strategy: "busLane", direction: "northbound" }],
      ...["jeongja", "jamsil", "dogok", "gangnam-yangjae", "gwanggyo"].flatMap((route) => [
        [`commute-${route}`, "up", { strategy: "car" }],
        [`commute-${route}`, "down", { strategy: "car" }],
      ]),
    ]);
    expect(Object.isFrozen(lane.corridor.centerline)).toBe(true);
  });
});

describe("loadLaneConfig", () => {
  it("fails a strategy for a sequence that is not estimated, naming it", () => {
    // Arrange
    const raw = copy();
    raw.strategies = { ...(raw.strategies as object), "fasttrack-inja": { regular: { strategy: "busLane", direction: "southbound" } } };

    // Act
    const message = loadError(raw);

    // Assert
    expect(message).toMatch(/^bus-lane\.json: strategies\.fasttrack-inja\.regular: .*fasttrack-inja regular/);
  });

  it("fails an unknown strategy at its path", () => {
    // Arrange
    const raw = copy();
    raw.strategies = { "campus-inja": { regular: { strategy: "express" } } };

    // Act
    const message = loadError(raw);

    // Assert
    expect(message).toMatch(/^bus-lane\.json: strategies\.campus-inja\.regular\.strategy: /);
  });

  it("fails a malformed corridor with every issue in one message", () => {
    // Arrange
    const raw = copy();
    const corridor = raw.corridor as { centerline: Array<Record<string, unknown>>; boundaries: Array<Record<string, unknown>> };
    corridor.centerline[0] = { lat: 37.5 };
    corridor.boundaries[2] = { name: "서초IC", alongM: "4330" };

    // Act
    const message = loadError(raw);

    // Assert
    expect(message).toContain("corridor.centerline.0.lng: ");
    expect(message).toContain("corridor.boundaries.2.alongM: ");
  });

  it("lists a sequence that is not estimated and a corridor cross-check issue together", () => {
    // Arrange
    const raw = copy();
    raw.strategies = { ...(raw.strategies as object), "campus-inja": { night: { strategy: "car" } } };
    const corridor = raw.corridor as { boundaries: Array<{ name: string; alongM: number }> };
    corridor.boundaries[0]!.alongM = 50;

    // Act
    const message = loadError(raw);

    // Assert
    expect(message).toContain("corridor.boundaries.0.alongM: ");
    expect(message).toContain("strategies.campus-inja.night: ");
  });

  it("resolves an estimated sequence the file leaves out to car", () => {
    // Arrange
    const raw = copy();
    raw.strategies = { "campus-inja": { regular: { strategy: "busLane", direction: "southbound" } } };

    // Act
    const lane = loadLaneConfig(raw, estimated);

    // Assert
    expect(strategyOf(lane.strategies, { serviceId: "campus-jain", routeType: "hakbu" })).toEqual({ strategy: "car" });
  });
});
