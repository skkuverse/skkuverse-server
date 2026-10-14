/**
 * The safety-net sweep for a lost crawler ping: registered with the poller registry only when
 * DISPATCH_SWEEP_ENABLED is "true", as "notices-dispatch-sweep" at the configured interval, sweeping as "cron";
 * a failed sweep rejects, which the registry reports.
 */
import config from "../../infra/config";
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { NoticesDispatchPoller } from "./notices-dispatch.poller";
import type { NoticesDispatchService } from "./notices-dispatch.service";

function setup() {
  const registerPoller = jest.fn();
  const sweepPending = jest.fn().mockResolvedValue({ status: "ok" });
  const poller = new NoticesDispatchPoller({ registerPoller } as unknown as PollerRegistryService, { sweepPending } as unknown as NoticesDispatchService);
  return { poller, registerPoller, sweepPending };
}

function withSweepFlag(value: string | undefined, run: () => void): void {
  const previous = process.env.DISPATCH_SWEEP_ENABLED;
  try {
    if (value === undefined) delete process.env.DISPATCH_SWEEP_ENABLED;
    else process.env.DISPATCH_SWEEP_ENABLED = value;
    run();
  } finally {
    if (previous === undefined) delete process.env.DISPATCH_SWEEP_ENABLED;
    else process.env.DISPATCH_SWEEP_ENABLED = previous;
  }
}

describe("NoticesDispatchPoller.onModuleInit", () => {
  it("registers the cron sweep when the flag is on", async () => {
    // Arrange
    const { poller, registerPoller, sweepPending } = setup();

    // Act
    withSweepFlag("true", () => poller.onModuleInit());

    // Assert
    expect(registerPoller).toHaveBeenCalledWith(expect.any(Function), config.notices.dispatch.sweepCronIntervalMs, "notices-dispatch-sweep");
    await registerPoller.mock.calls[0][0]();
    expect(sweepPending).toHaveBeenCalledWith("cron");
  });

  it.each([undefined, "false", "1"])("registers nothing when the flag is %j", (flag) => {
    // Arrange
    const { poller, registerPoller } = setup();

    // Act
    withSweepFlag(flag, () => poller.onModuleInit());

    // Assert
    expect(registerPoller).not.toHaveBeenCalled();
  });

  it("lets a failed sweep reject, for the registry to report", async () => {
    // Arrange
    const { poller, registerPoller, sweepPending } = setup();
    sweepPending.mockRejectedValueOnce(new Error("mongo down"));
    withSweepFlag("true", () => poller.onModuleInit());

    // Act & Assert
    await expect(registerPoller.mock.calls[0][0]()).rejects.toThrow("mongo down");
  });
});
