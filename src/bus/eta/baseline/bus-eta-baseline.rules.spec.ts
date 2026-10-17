/**
 * The baseline rules: refreshCutoff is the latest 04:00 KST at or before now.
 */
import moment from "moment-timezone";
import { refreshCutoff } from "./bus-eta-baseline.rules";

const kst = (date: string, hhmm: string) => moment.tz(`${date} ${hhmm}`, "YYYY-MM-DD HH:mm", "Asia/Seoul").toDate();

describe("refreshCutoff", () => {
  it("is the latest 04:00 KST at or before now", () => {
    // Act & Assert
    expect(refreshCutoff(kst("2026-10-12", "03:59"))).toEqual(kst("2026-10-11", "04:00"));
    expect(refreshCutoff(kst("2026-10-12", "04:00"))).toEqual(kst("2026-10-12", "04:00"));
    expect(refreshCutoff(kst("2026-10-12", "23:30"))).toEqual(kst("2026-10-12", "04:00"));
  });
});

