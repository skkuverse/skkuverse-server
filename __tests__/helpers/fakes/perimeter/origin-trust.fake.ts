import type { OriginTrust } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** Trusts the origins in `trusted`, or throws `failure` once a test sets one, and keeps the origins it was asked. */
export class FakeOriginTrust implements PublicOf<OriginTrust> {
  readonly trusted = new Set<string>();
  failure: Error | undefined;
  readonly asked: string[] = [];

  isCorsOrigin(origin: string): boolean {
    this.asked.push(origin);
    if (this.failure) throw this.failure;
    return this.trusted.has(origin);
  }
}
