/**
 * What a contract suite hands an implementation (ADR 0023, D4): deps as the poller would build them, whose token
 * reader throws, so a constructor that reads a token fails the suite, and a request view built from plain headers.
 */
import { Writable } from "node:stream";
import pino from "pino";
import { toCounterWindow } from "../../../src/perimeter/perimeter-counters.rules";
import type { InternalScopeName, PerimeterCounters, PerimeterDeps, PerimeterRequest } from "../../../src/perimeter/perimeter.ports";

export const CONTRACT_NOW = new Date("2026-10-19T16:30:00Z");

/** Counts in memory, one count per key and window of the deps' clock, as the shared counters do across processes. */
export class MemoryPerimeterCounters implements PerimeterCounters {
  readonly counts = new Map<string, number>();

  constructor(private readonly now: () => Date) {}

  increment(key: string, windowSeconds: number): ReturnType<PerimeterCounters["increment"]> {
    const { counterId } = toCounterWindow(key, windowSeconds, this.now());
    const count = (this.counts.get(counterId) ?? 0) + 1;
    this.counts.set(counterId, count);
    const release = () => {
      this.counts.set(counterId, Math.max(0, (this.counts.get(counterId) ?? 0) - 1));
      return Promise.resolve();
    };
    return Promise.resolve({ count, release });
  }
}

/** A logger whose lines a test reads back as parsed JSON objects. */
export function capturingLogger(): { logger: PerimeterDeps["logger"]; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { logger: pino({ level: "debug" }, stream), lines };
}

export function throwingTokenReader(scope: InternalScopeName): string {
  throw new Error(`internalToken(${scope}) read where no internal token is required, as on the poller`);
}

export function perimeterTestDeps(overrides: Partial<PerimeterDeps> = {}): PerimeterDeps {
  const now = overrides.now ?? (() => CONTRACT_NOW);
  return {
    logger: pino({ level: "silent" }),
    now,
    host: "127.0.0.1",
    firebaseProjectId: "demo-perimeter-contract",
    settings: {},
    counters: new MemoryPerimeterCounters(now),
    internalToken: throwingTokenReader,
    ...overrides,
  };
}

/** The case every contract shares: the poller constructs every class, with no token to read. */
export function itConstructsLikeThePoller<P>(make: (deps: PerimeterDeps) => P): void {
  it("constructs with deps whose token reader throws, as the poller does", () => {
    // Act & Assert
    expect(() => make(perimeterTestDeps())).not.toThrow();
  });
}

export interface RequestInit {
  method?: string;
  target?: string;
  ip?: string;
  headers?: Record<string, string>;
}

export function perimeterRequest({ method = "GET", target = "/", ip = "203.0.113.7", headers = {} }: RequestInit = {}): PerimeterRequest {
  const byName = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return { method, target, ip, header: (name) => byName.get(name.toLowerCase()) };
}
