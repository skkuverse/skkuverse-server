/**
 * DailyCap, the per-upstream call budget: the cap's calls pass in a KST day,
 * the next one throws a DailyCapError naming the upstream and the cap, and
 * the count starts over at 00:00 KST, not at 00:00 UTC.
 */
import { DailyCapError } from "./daily-cap.error";
import { DailyCap } from "./daily-cap.util";

describe("DailyCap", () => {
  it("allows the cap's calls in a KST day and starts over at 00:00 KST", () => {
    // Arrange
    const cap = new DailyCap("tmap", 2);
    const evening = new Date("2026-10-12T14:59:00.000Z"); // 23:59 KST
    const midnight = new Date("2026-10-12T15:00:00.000Z"); // 00:00 KST next day

    // Act & Assert
    cap.take(evening);
    cap.take(evening);
    expect(() => cap.take(evening)).toThrow(DailyCapError);
    expect(() => cap.take(midnight)).not.toThrow();
  });

  it.each([
    [1, false],
    [2, false],
    [3, true],
  ])("call %i of a cap of 2 throws: %s", (call, throws) => {
    // Arrange
    const cap = new DailyCap("naver", 2);
    const now = new Date("2026-10-12T03:00:00.000Z");
    for (let i = 1; i < call; i++) cap.take(now);

    // Act
    const take = () => cap.take(now);

    // Assert
    if (throws) expect(take).toThrow(DailyCapError);
    else expect(take).not.toThrow();
  });

  it("does not start over at 00:00 UTC, which is 09:00 KST of the same day", () => {
    // Arrange
    const cap = new DailyCap("tmap", 1);
    cap.take(new Date("2026-10-19T16:30:00.000Z")); // 01:30 KST on the 20th

    // Act & Assert
    expect(() => cap.take(new Date("2026-10-20T00:00:00.000Z"))).toThrow(DailyCapError);
    expect(() => cap.take(new Date("2026-10-20T15:00:00.000Z"))).not.toThrow();
  });

  it("throws an error that carries only the upstream and the cap", () => {
    // Arrange
    const cap = new DailyCap("naver", 0);

    // Act
    const err = (() => {
      try {
        cap.take(new Date("2026-10-12T03:00:00.000Z"));
      } catch (e) {
        return e;
      }
    })();

    // Assert
    expect(err).toBeInstanceOf(DailyCapError);
    const capError = err as DailyCapError;
    expect({ name: capError.name, message: capError.message, provider: capError.provider, cap: capError.cap }).toEqual({
      name: "DailyCapError",
      message: "naver: daily cap of 0 calls reached",
      provider: "naver",
      cap: 0,
    });
  });
});
