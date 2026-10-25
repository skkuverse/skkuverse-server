/**
 * The window a shared count falls in: aligned to the epoch, so two processes counting one key in the same window
 * write one document, and expiring when the window ends.
 */
import { toCounterWindow } from "./perimeter-counters.rules";

describe("toCounterWindow", () => {
  it.each([
    ["at the window's first instant", "2026-10-19T16:00:00.000Z", "2026-10-19T16:00:00.000Z"],
    ["one millisecond into it", "2026-10-19T16:00:00.001Z", "2026-10-19T16:00:00.000Z"],
    ["one millisecond before the next", "2026-10-19T16:59:59.999Z", "2026-10-19T16:00:00.000Z"],
    ["at the next window's first instant", "2026-10-19T17:00:00.000Z", "2026-10-19T17:00:00.000Z"],
  ])("puts an hour window's count %s in the window starting %s", (_label, now, startedAt) => {
    // Act
    const window = toCounterWindow("push:mukja", 3600, new Date(now));

    // Assert
    expect(window).toEqual({ counterId: `push:mukja@${startedAt}`, expiresAt: new Date(new Date(startedAt).getTime() + 3_600_000) });
  });
});
