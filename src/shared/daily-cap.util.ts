import { DailyCapError } from "./daily-cap.error";
import { toKstDate } from "./kst-date.util";

/**
 * WHY: calls left today for one upstream, starting over at 00:00 KST. The counter lives in the process that makes
 * the calls; a restart starts it over, which the upstream's own limits still bound.
 */
export class DailyCap {
  private day = "";
  private used = 0;

  constructor(
    private readonly provider: string,
    private readonly cap: number,
  ) {}

  take(now: Date): void {
    const day = toKstDate(now);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.cap) throw new DailyCapError(this.provider, this.cap);
    this.used += 1;
  }
}
