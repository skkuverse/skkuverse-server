import type { AxiosRequestConfig } from "axios";
import type { OutboundPolicy, OutboundPurpose } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** The error a test throws where the real policy would refuse while fetching; `isBlocked` recognizes it alone. */
export class FakeOutboundRefusal extends Error {}

/** Allows every URL but those in `refused`, hands out `config`, and keeps the URLs it was asked about. */
export class FakeOutboundPolicy implements PublicOf<OutboundPolicy> {
  readonly refused = new Set<string>();
  config: AxiosRequestConfig = {};
  readonly asked: Array<{ purpose: OutboundPurpose; url: string }> = [];

  allows(purpose: OutboundPurpose, url: string): boolean {
    this.asked.push({ purpose, url });
    return !this.refused.has(url);
  }

  requestConfig(): AxiosRequestConfig {
    return { ...this.config };
  }

  isBlocked(err: unknown): boolean {
    return err instanceof FakeOutboundRefusal;
  }
}
