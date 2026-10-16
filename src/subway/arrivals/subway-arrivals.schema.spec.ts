/**
 * stationIdParam: a station id of the KRIC shape, `<operator>-<line>-<station>`
 * in upper-case letters and digits, passes as it is; anything else is refused,
 * which the route answers as a station it does not serve.
 */
import { stationIdParam } from "./subway-arrivals.schema";

describe("stationIdParam", () => {
  it.each(["KR-1-0153", "S1-4-420", "S1-2-222", "KR-1-P154"])("passes %s as it is", (id) => {
    // Act
    const parsed = stationIdParam.safeParse(id);

    // Assert
    expect(parsed).toEqual({ success: true, data: id });
  });

  it.each(["kr-1-0153", "KR-1", "KR-1-0153-9", "KR_1_0153", "", "KR-1-0153 "])("refuses %j", (id) => {
    // Act
    const parsed = stationIdParam.safeParse(id);

    // Assert
    expect(parsed.success).toBe(false);
  });
});
