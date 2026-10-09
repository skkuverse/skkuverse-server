/**
 * Wiring of the arrival-estimate pollers: SHUTTLE_ETA gates registration, the
 * shuttle_eta indexes are ensured warn-and-continue, and the opted-in
 * sequences carry their stops' coordinates.
 */
jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock("../../../src/bus/eta/eta-store", () => ({
  ...jest.requireActual("../../../src/bus/eta/eta-store"),
  ensureEtaIndexes: jest.fn(),
  readEtas: jest.fn(),
  writeEtas: jest.fn(),
}));

import config from "../../../src/infra/config";
import logger from "../../../src/infra/logger";
import { ensureEtaIndexes } from "../../../src/bus/eta/eta-store";
import { etaSequences, sequenceLengths } from "../../../src/bus/eta/eta-sequences";
import { ShuttleEtaPollerService } from "../../../src/bus/eta/shuttle-eta-poller.service";
import type { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import type { ScheduleService } from "../../../src/bus/schedule/schedule.service";

const mockedEnsure = ensureEtaIndexes as jest.Mock;
const shuttleEta = config.shuttleEta as { enabled: boolean };

function build() {
  const registry = { registerPoller: jest.fn() };
  const service = new ShuttleEtaPollerService(
    registry as unknown as PollerRegistryService,
    {} as unknown as ScheduleService,
  );
  return { service, registry };
}

describe("ShuttleEtaPollerService", () => {
  const enabled = shuttleEta.enabled;
  afterEach(() => {
    shuttleEta.enabled = enabled;
    jest.clearAllMocks();
  });

  it("SHUTTLE_ETA=off registers nothing and touches no collection", async () => {
    shuttleEta.enabled = false;
    const { service, registry } = build();
    await service.onModuleInit();
    expect(registry.registerPoller).not.toHaveBeenCalled();
    expect(mockedEnsure).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({ event: "bus.eta.disabled" }, expect.any(String));
  });

  it("registers shuttle-eta-live every 60 s and shuttle-eta-baseline every 5 min, after the indexes", async () => {
    shuttleEta.enabled = true;
    mockedEnsure.mockResolvedValue(undefined);
    const { service, registry } = build();
    await service.onModuleInit();
    expect(mockedEnsure).toHaveBeenCalledTimes(1);
    expect(registry.registerPoller.mock.calls.map((c) => [c[2], c[1]])).toEqual([
      ["shuttle-eta-live", 60_000],
      ["shuttle-eta-baseline", 300_000],
    ]);
  });

  it("a failed index setup is warned, not fatal", async () => {
    shuttleEta.enabled = true;
    const err = new Error("not primary");
    mockedEnsure.mockRejectedValue(err);
    const { service, registry } = build();
    await service.onModuleInit();
    expect(logger.warn).toHaveBeenCalledWith({ event: "bus.eta.indexes_failed", err }, expect.any(String));
    expect(registry.registerPoller).toHaveBeenCalledTimes(2);
  });
});

describe("etaSequences", () => {
  it("lists the opted-in route types with their stops' coordinates, in order", () => {
    const seqs = etaSequences();
    expect(seqs.map((s) => `${s.serviceId}.${s.routeType}:${s.stops.length}`)).toEqual([
      "campus-inja.regular:3",
      "campus-jain.regular:2",
      "campus-jain.hakbu:2",
    ]);
    expect(seqs[0]!.stops).toEqual([
      { lat: 37.587367, lng: 126.993643 },
      { lat: 37.292298, lng: 126.975057 },
      { lat: 37.293999, lng: 126.973183 },
    ]);
    const length = sequenceLengths(seqs);
    expect(length("campus-jain", "hakbu")).toBe(2);
    expect(length("campus-inja", "hakbu")).toBeUndefined();
  });
});
