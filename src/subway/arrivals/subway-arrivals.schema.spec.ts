/**
 * stationIdParam: a station's slug, lowercase letters and digits in parts
 * joined by single hyphens, passes as it is; anything else, a KRIC platform
 * id included, is refused, which the route answers as a station it does not
 * serve.
 */
import { stationIdParam } from "./subway-arrivals.schema";

describe("stationIdParam", () => {
  it.each(["sungkyunkwan", "hyehwa", "gangnam", "gwanggyo-jungang", "seoul"])("passes %s as it is", (slug) => {
    // Act
    const parsed = stationIdParam.safeParse(slug);

    // Assert
    expect(parsed).toEqual({ success: true, data: slug });
  });

  it.each(["S1-4-420", "KR-1-P153", "Hyehwa", "gwanggyo--jungang", "-hyehwa", "hyehwa-", "hye_hwa", "", "hyehwa "])("refuses %j", (slug) => {
    // Act
    const parsed = stationIdParam.safeParse(slug);

    // Assert
    expect(parsed.success).toBe(false);
  });
});
