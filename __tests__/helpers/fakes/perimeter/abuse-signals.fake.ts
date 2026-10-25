import type { AbuseSignal, AbuseSignals } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** Keeps every signal reported. */
export class FakeAbuseSignals implements PublicOf<AbuseSignals> {
  readonly signals: AbuseSignal[] = [];

  report(signal: AbuseSignal): void {
    this.signals.push(signal);
  }
}
