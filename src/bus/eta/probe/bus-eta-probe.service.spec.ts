/**
 * BusEtaProbeService over a scripted TOPIS client and an in-memory span store,
 * on revision 1 of the stored corridor, which each call is handed as a
 * snapshot (move-reference-datasets D9): at most one request per probe route and minute,
 * shared by both directions; no corridor time without a snapshot 5 to 15
 * minutes older; a corridor time once a prime ten minutes earlier gives every
 * bus a partner, with its spans recorded once; every client failure,
 * the daily cap included, rejecting for the live tick to handle; and a new
 * corridor revision starting the pairing over, since along-distances of two
 * revisions do not compare.
 */
import { corridorFixture, corridorSnapshot } from "../../../../__tests__/helpers/bus/bus-lane-corridor";
import { FakeBusEtaProbeClient } from "../../../../__tests__/helpers/fakes/bus/bus-eta-probe.client.fake";
import { FakeBusEtaProbeRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta-probe.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { DailyCapError } from "../../../shared/daily-cap.error";
import { BusEtaDirectionsError } from "../bus-eta.error";
import type { BusEtaProbeClient } from "./bus-eta-probe.client";
import type { BusEtaProbeRepository } from "./bus-eta-probe.repository";
import { BusEtaProbeService } from "./bus-eta-probe.service";
import type { LanePosition } from "./bus-eta-probe.types";

const MINUTE_MS = 60_000;
// Friday 2026-10-16 20:44 KST.
const NOW = new Date("2026-10-16T11:44:00.000Z");
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE_MS);

const CORRIDOR = corridorSnapshot();
const { centerline } = CORRIDOR.corridor;
const PROBE_ROUTE_IDS = ["200000205", "228000174", "228000175"];

// 8800 southbound runs through sections 45–56; the centerline has a vertex about every 200 m.
function southbound8800(vertices: number[], seenAt: Date): LanePosition[] {
  const dataTm = new Date(seenAt.getTime() - 45_000);
  return vertices.map((vertex, k) => ({ vehId: `bus-${k}`, ...centerline[vertex]!, sectOrd: 50, dataTm }));
}

function setup() {
  const client = new FakeBusEtaProbeClient();
  const spans = new FakeBusEtaProbeRepository();
  const probe = new BusEtaProbeService(asReal<BusEtaProbeClient>(client), asReal<BusEtaProbeRepository>(spans));
  return { client, spans, probe };
}

describe("BusEtaProbeService.legTime", () => {
  it("Both directions at the same tick: one request per probe route serves the minute", async () => {
    // Arrange
    const { client, probe } = setup();

    // Act
    await probe.legTime(CORRIDOR, "southbound", NOW);
    await probe.legTime(CORRIDOR, "northbound", new Date(NOW.getTime() + 30_000));

    // Assert
    expect(client.calls.map((call) => call.routeId).sort()).toEqual(PROBE_ROUTE_IDS);
  });

  it("cannot answer on its first call: no bus has an earlier snapshot to pair with", async () => {
    // Arrange
    const { client, probe } = setup();
    client.positionsByRoute.set("200000205", southbound8800([45, 85, 125], NOW));

    // Act
    const leg = await probe.legTime(CORRIDOR, "southbound", NOW);

    // Assert
    expect(leg).toEqual({ kind: "unavailable", reason: "noSpans", spanCount: 0, coverage: 0 });
  });

  it("Priming before the window: after a prime ten minutes earlier it times the corridor and records the spans", async () => {
    // Arrange
    const { client, spans, probe } = setup();
    client.positionsByRoute.set("200000205", southbound8800([5, 45, 85], minutesBefore(10)));
    await probe.prime(CORRIDOR, minutesBefore(10));
    client.positionsByRoute.set("200000205", southbound8800([45, 85, 125], NOW));

    // Act
    const leg = await probe.legTime(CORRIDOR, "southbound", NOW);

    // Assert
    // Each bus covered about 8 km in ten minutes, about 48 km/h, over most of the 26.4 km leg.
    expect(leg).toMatchObject({ kind: "probe", spanCount: 3 });
    if (leg.kind !== "probe") throw new Error("expected a corridor time");
    expect(leg.coverage).toBeGreaterThan(0.85);
    expect(leg.corridorSec).toBeGreaterThan(1_800);
    expect(leg.corridorSec).toBeLessThan(2_200);
    expect([...spans.spans.values()].map((span) => ({ vehId: span.vehId, direction: span.direction, toAt: span.toAt }))).toEqual(
      ["bus-0", "bus-1", "bus-2"].map((vehId) => ({ vehId, direction: "southbound", toAt: new Date(NOW.getTime() - 45_000) })),
    );
  });

  it("does not time the other direction from these spans, and records the minute's spans once", async () => {
    // Arrange
    const { client, spans, probe } = setup();
    client.positionsByRoute.set("200000205", southbound8800([5, 45, 85], minutesBefore(10)));
    await probe.prime(CORRIDOR, minutesBefore(10));
    client.positionsByRoute.set("200000205", southbound8800([45, 85, 125], NOW));

    // Act
    await probe.legTime(CORRIDOR, "southbound", NOW);
    const northbound = await probe.legTime(CORRIDOR, "northbound", NOW);

    // Assert
    expect(northbound).toEqual({ kind: "unavailable", reason: "noSpans", spanCount: 0, coverage: 0 });
    expect(spans.recordCalls).toBe(1);
    expect(client.calls).toHaveLength(6);
  });

  it("Bus position service down: a client failure rejects, and the minute does not ask again", async () => {
    // Arrange
    const { client, probe } = setup();
    const outage = new BusEtaDirectionsError("topis", "http", "HTTP 503", 503);
    client.failWith = outage;

    // Act
    const first = await probe.legTime(CORRIDOR, "southbound", NOW).catch((e: unknown) => e);
    const second = await probe.legTime(CORRIDOR, "northbound", NOW).catch((e: unknown) => e);

    // Assert
    expect(first).toBe(outage);
    expect(second).toBe(outage);
    expect(client.calls).toHaveLength(3);
  });

  it("rejects with the daily cap's own error, so a capped day reads apart from an outage", async () => {
    // Arrange
    const { client, probe } = setup();
    client.failWith = new DailyCapError("topis", 2000);

    // Act & Assert
    await expect(probe.legTime(CORRIDOR, "southbound", NOW)).rejects.toBeInstanceOf(DailyCapError);
  });

  it("asks again in the next minute after a failed one", async () => {
    // Arrange
    const { client, probe } = setup();
    client.failWith = new BusEtaDirectionsError("topis", "timeout", "timed out (ECONNABORTED)");
    await probe.legTime(CORRIDOR, "southbound", NOW).catch(() => undefined);
    client.failWith = null;

    // Act
    const leg = await probe.legTime(CORRIDOR, "southbound", new Date(NOW.getTime() + MINUTE_MS));

    // Assert
    expect(leg.kind).toBe("unavailable");
    expect(client.calls).toHaveLength(6);
  });
});

describe("BusEtaProbeService.prime", () => {
  it("takes one snapshot per probe route and computes nothing", async () => {
    // Arrange
    const { client, spans, probe } = setup();

    // Act
    await probe.prime(CORRIDOR, minutesBefore(10));
    await probe.prime(CORRIDOR, minutesBefore(10));

    // Assert
    expect(client.calls.map((call) => call.routeId).sort()).toEqual(PROBE_ROUTE_IDS);
    expect(spans.recordCalls).toBe(0);
  });
});

describe("BusEtaProbeService.legTime over an edited corridor", () => {
  it("Probe routes edited: a corridor without 8800 asks TOPIS for no 8800 position", async () => {
    // Arrange
    const { client, probe } = setup();
    const edited = corridorFixture();
    edited.probeRoutes = edited.probeRoutes.filter((route) => route.name !== "8800");

    // Act
    await probe.legTime(corridorSnapshot(edited, 2), "southbound", NOW);

    // Assert
    expect(client.calls.map((call) => call.routeId).sort()).toEqual(["228000174", "228000175"]);
  });
});

describe("BusEtaProbeService.legTime after a corridor push", () => {
  it("pairs no fix taken under the earlier revision with one taken under the new one", async () => {
    // Arrange
    const { client, spans, probe } = setup();
    client.positionsByRoute.set("200000205", southbound8800([5, 45, 85], minutesBefore(10)));
    await probe.prime(CORRIDOR, minutesBefore(10));
    const pushed = corridorSnapshot(corridorFixture(), 2);
    client.positionsByRoute.set("200000205", southbound8800([25, 65, 105], minutesBefore(5)));
    await probe.prime(pushed, minutesBefore(5));
    client.positionsByRoute.set("200000205", southbound8800([45, 85, 125], NOW));

    // Act
    await probe.legTime(pushed, "southbound", NOW);

    // Assert
    // Revision 1's fixes are ten minutes old, the partner age a span prefers; only revision 2's five-minute-old ones may pair.
    const fromAts = [...spans.spans.values()].map((span) => span.fromAt);
    expect(fromAts).toEqual(Array.from({ length: 3 }, () => new Date(minutesBefore(5).getTime() - 45_000)));
  });
});
