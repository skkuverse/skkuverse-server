/**
 * Keeps every test off the network (harden-test-suite design D5). Loaded by
 * `setupFiles` in `jest.config.js`, so it runs before each test file: a
 * connection to anything but loopback fails the test and names the host.
 *
 * `net.Socket.prototype.connect` is the one door that net, tls, http, https
 * and undici's fetch all go through. `dns.lookup` and `dns.promises.lookup`
 * cover a bare lookup. `globalThis.fetch` is wrapped too, so its refusal names
 * the URL at the call instead of surfacing as undici's "fetch failed".
 *
 * A refusal throws (fetch: rejects) at the call. Code under test often swallows
 * that error (a fire-and-forget prefetch, a poller), so the guard also rethrows
 * it from a microtask, which Jest reports against the running test or hook. A
 * test that expects a refusal takes it with `takeBlockedConnections()` in the
 * same tick.
 *
 * A worker runs its test files one after another, and Jest pins an uncaught
 * error on whatever test is running. So a refusal made by code an earlier file
 * left running (a timer, a poller) is written to stderr instead of rethrown: it
 * would fail an unrelated test, with a blank message once that file is torn down.
 */
import { AsyncResource, executionAsyncId } from "node:async_hooks";
import dns from "node:dns";
import net from "node:net";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

type Connect = typeof net.Socket.prototype.connect;
type Lookup = typeof dns.lookup;
type PromisesLookup = typeof dns.promises.lookup;

interface Originals {
  connect: Connect;
  lookup: Lookup;
  promisesLookup: PromisesLookup;
}

// net and dns are the worker's real modules, shared by every test file,
// while setupFiles runs once per file; the first run saves the unpatched ones.
// Each file then wraps those originals afresh rather than patching once per
// worker: a refusal is built in the running file's realm, and Jest blanks the
// stack of every error built in a realm it has torn down.
const ORIGINALS = Symbol.for("skkuverse.networkGuard.originals");
const PENDING = Symbol.for("skkuverse.networkGuard.pending");
const GUARDED = Symbol.for("skkuverse.networkGuard.guarded");

export class NetworkGuardError extends Error {
  readonly code = "ENETWORKGUARD";

  constructor(readonly target: string, via: string) {
    super(
      `Network guard: refused ${via} to ${target}. Tests reach loopback only ` +
        "(127.0.0.1, ::1, localhost); stub fetch, axios or the client instead.",
    );
    this.name = "NetworkGuardError";
  }
}

function originals(): Originals {
  const holder = net as unknown as Record<symbol, Originals | undefined>;
  holder[ORIGINALS] ??= {
    connect: net.Socket.prototype.connect,
    lookup: dns.lookup,
    promisesLookup: dns.promises.lookup,
  };
  return holder[ORIGINALS];
}

function pendingRefusals(): NetworkGuardError[] {
  const holder = globalThis as unknown as Record<symbol, NetworkGuardError[] | undefined>;
  holder[PENDING] ??= [];
  return holder[PENDING];
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase().replace(/^\[(.*)\]$/, "$1"));
}

// Captured at setup, before a test can install fake timers over it.
const realQueueMicrotask = globalThis.queueMicrotask;
const writeStderr = process.stderr.write.bind(process.stderr);

// Async ids only grow, so a timer or socket callback whose resource is older
// than this mark was started by an earlier file. Without async hooks a promise
// continuation reports id 0, and counts as this file's.
const FIRST_ASYNC_ID_OF_THIS_FILE = new AsyncResource("NetworkGuardFileStart").asyncId();

function isCallFromFinishedFile(): boolean {
  // `jest` is this file's own Jest object, so it knows when this file is torn down.
  if (jest.isEnvironmentTornDown()) return true;
  const asyncId = executionAsyncId();
  return asyncId > 0 && asyncId < FIRST_ASYNC_ID_OF_THIS_FILE;
}

function reportStray(error: NetworkGuardError): void {
  const trace = error.stack !== undefined && error.stack !== "" ? error.stack : error.message;
  writeStderr(`${trace}\n(Made by code a finished test file left running, so it fails no test.)\n`);
}

function refuse(target: string, via: string, door: (...args: never[]) => unknown): NetworkGuardError {
  const error = new NetworkGuardError(target, via);
  // Starts the stack at the caller, which is the frame Jest prints.
  Error.captureStackTrace(error, door);
  if (isCallFromFinishedFile()) {
    reportStray(error);
    return error;
  }
  const pending = pendingRefusals();
  pending.push(error);
  realQueueMicrotask(() => {
    const index = pending.indexOf(error);
    if (index === -1) return;
    pending.splice(index, 1);
    throw error;
  });
  return error;
}

/** The targets refused since the last call, as `host:port` (a lookup: `host`); they are not reported again. */
export function takeBlockedConnections(): string[] {
  const pending = pendingRefusals();
  return pending.splice(0, pending.length).map((error) => error.target);
}

/** Host and port of a `Socket#connect` call, or undefined for an IPC path. */
function connectTarget(args: readonly unknown[]): { host: string; port: unknown } | undefined {
  const [first, second] = args;
  // net.connect passes its already-normalized `[options, callback]` array as one argument.
  const options: unknown = Array.isArray(first) ? first[0] : first;
  if (typeof options === "object" && options !== null) {
    const { host, port, path } = options as { host?: unknown; port?: unknown; path?: unknown };
    if (typeof path === "string" && path !== "") return undefined;
    return { host: typeof host === "string" && host !== "" ? host : "localhost", port };
  }
  if (typeof options === "number" || (typeof options === "string" && /^\d+$/.test(options))) {
    return { host: typeof second === "string" && second !== "" ? second : "localhost", port: options };
  }
  return undefined;
}

function guardConnect(original: Connect): Connect {
  return function guardedConnect(this: net.Socket, ...args: unknown[]): net.Socket {
    const target = connectTarget(args);
    if (target && !isLoopbackHost(target.host)) {
      this.destroy();
      throw refuse(`${target.host}:${String(target.port)}`, "connect", guardedConnect);
    }
    return Reflect.apply(original, this, args) as net.Socket;
  } as Connect;
}

function guardLookup<F extends Lookup | PromisesLookup>(original: F, via: string): F {
  const guarded = function guardedLookup(this: unknown, hostname: unknown, ...rest: unknown[]): unknown {
    if (typeof hostname === "string" && hostname !== "" && !isLoopbackHost(hostname)) {
      const error = refuse(hostname, via, guardedLookup);
      if (via === "dns.promises.lookup") return Promise.reject(error);
      throw error;
    }
    return Reflect.apply(original, this, [hostname, ...rest]);
  };
  // util.promisify(dns.lookup) reads a symbol on the function to resolve `{ address, family }`.
  for (const symbol of Object.getOwnPropertySymbols(original)) {
    Object.defineProperty(guarded, symbol, Object.getOwnPropertyDescriptor(original, symbol) ?? {});
  }
  return guarded as unknown as F;
}

function fetchTarget(input: unknown): string | undefined {
  const raw = typeof input === "object" && input !== null && "url" in input ? String(input.url) : String(input);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
  return isLoopbackHost(url.hostname) ? undefined : `${url.hostname}:${port}`;
}

function guardFetch(original: typeof fetch): typeof fetch {
  const guarded = function guardedFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    const target = fetchTarget(input);
    if (target !== undefined) return Promise.reject(refuse(target, "fetch", guardedFetch));
    return original(input, init);
  };
  Object.defineProperty(guarded, GUARDED, { value: true });
  return guarded;
}

function installNetworkGuard(): void {
  const saved = originals();
  net.Socket.prototype.connect = guardConnect(saved.connect);
  Object.assign(dns, { lookup: guardLookup(saved.lookup, "dns.lookup") });
  Object.assign(dns.promises, { lookup: guardLookup(saved.promisesLookup, "dns.promises.lookup") });
  const contextFetch = globalThis.fetch as (typeof fetch & { [GUARDED]?: true }) | undefined;
  if (contextFetch && !contextFetch[GUARDED]) globalThis.fetch = guardFetch(contextFetch);
}

installNetworkGuard();
