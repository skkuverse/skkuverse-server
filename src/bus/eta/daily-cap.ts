import moment from "moment-timezone";
import type { DirectionsProvider } from "./directions-error";

/** A directions call refused because the day's cap was reached. */
export class DailyCapError extends Error {
  constructor(
    readonly provider: DirectionsProvider,
    readonly cap: number,
  ) {
    super(`${provider}: daily cap of ${cap} calls reached`);
    this.name = "DailyCapError";
  }
}

/**
 * Calls left today for one provider (design D10). The counter lives in the
 * poller process, which is the only caller, and starts over at 00:00 KST. A
 * restart starts it over too, which can let one day exceed the cap by what was
 * spent before the restart — the providers' own limits still hold.
 */
export class DailyCap {
  private day = "";
  private used = 0;

  constructor(
    private readonly provider: DirectionsProvider,
    private readonly cap: number,
  ) {}

  /** Counts one call, or throws DailyCapError when today's calls are spent. */
  take(now: Date): void {
    const day = moment(now).tz("Asia/Seoul").format("YYYY-MM-DD");
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.cap) throw new DailyCapError(this.provider, this.cap);
    this.used += 1;
  }
}
