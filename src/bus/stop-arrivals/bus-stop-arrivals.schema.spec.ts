/**
 * stopIdParam: a stop id, lower-case letters and digits in words joined by single hyphens (a slug or a TOPIS pole's
 * `seoul-<arsId>`), passes as it is; anything else is refused, which the route answers as a stop it does not serve.
 */
import { stopIdParam } from "./bus-stop-arrivals.schema";

describe("stopIdParam", () => {
  it.each(["seoul-01592", "hssc-bus-lot", "nsc-n-center", "jeongja-exit3", "seoul-99999"])("passes %s as it is", (stopId) => {
    // Act
    const parsed = stopIdParam.safeParse(stopId);

    // Assert
    expect(parsed).toEqual({ success: true, data: stopId });
  });

  it.each(["Seoul_01592", "SEOUL-01592", "seoul--01592", "-seoul", "seoul-", "hssc bus", "", "01592 "])("refuses %j", (stopId) => {
    // Act
    const parsed = stopIdParam.safeParse(stopId);

    // Assert
    expect(parsed.success).toBe(false);
  });
});
