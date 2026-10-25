/**
 * createLogThrottle lets one line per key through per interval and reports how
 * many it held back in between.
 */
import { createLogThrottle } from "./log-throttle.util";

describe("createLogThrottle", () => {
  it("lets one line per key through per interval and counts the rest", () => {
    // Arrange
    let now = 0;
    const throttle = createLogThrottle(1000, () => now);

    // Act & Assert
    expect(throttle.take("a")).toEqual({ suppressed: 0 });
    expect(throttle.take("a")).toBeNull();
    expect(throttle.take("a")).toBeNull();
    expect(throttle.take("b")).toEqual({ suppressed: 0 });
    now = 1000;
    expect(throttle.take("a")).toEqual({ suppressed: 2 });
  });
});
