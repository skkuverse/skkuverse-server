// SEE: docs/decisions/0023-perimeter-ports.md — the public side of the security perimeter: what each port
// decides, never how. An implementation imports this file, never the code that calls it.
import type { AxiosRequestConfig } from "axios";
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import type { LinkActionType } from "../shared/link-action.wire";

// WHY: bumped on every change to this file once an overlay is built against it; a loaded implementation set built
// against another value fails the boot.
export const PERIMETER_PORTS_VERSION = 1;

export const PERIMETER_MODES = ["overlay", "local-dev", "test"] as const;
export type PerimeterMode = (typeof PERIMETER_MODES)[number];

// WHY: `target` is the request line's path and query as received, never a router-rewritten path, so a signature over
// it checks what the caller sent.
export interface PerimeterRequest {
  readonly method: string;
  readonly target: string;
  readonly ip: string | undefined;
  header(name: string): string | undefined;
}

export type Principal =
  | { readonly kind: "anonymous" }
  | { readonly kind: "user"; readonly uid: string; readonly signInProvider: string };

export type Authentication = Principal | { readonly kind: "rejected" };

// WHY: middleware, not a guard, so the principal exists before a limiter keys on it, and a rejected credential
// answers 401 without spending a limiter's count.
export abstract class RequestAuthenticator {
  abstract authenticate(request: PerimeterRequest): Promise<Authentication>;
}

export const RATE_LIMIT_CLASSES = ["general", "notices", "notices-overview"] as const;
export type RateLimitClass = (typeof RATE_LIMIT_CLASSES)[number];

export const RATE_LIMITED_BODY = { error: { code: "RATE_LIMIT", message: "Too many requests" } } as const;

// WHY: the one port that hands back Express code, so a limiter stays a library middleware; one handler per class
// for the process, so every module that binds a class shares its count.
export abstract class RateLimitPolicy {
  abstract handlerFor(limitClass: RateLimitClass): RequestHandler;
}

export const INTERNAL_SCOPES = ["notices.dispatch", "subway.accuracy", "miniapps.push"] as const;
export type InternalScopeName = (typeof INTERNAL_SCOPES)[number];

export abstract class InternalAuthorizer {
  abstract authorize(scope: InternalScopeName, request: PerimeterRequest): Promise<boolean>;
}

export const PUSH_SCOPES = ["push.send", "push.history"] as const;
export type PushScope = (typeof PUSH_SCOPES)[number];

export interface SigningKey {
  readonly keyId: string;
  readonly publicKey: string;
}

export interface SenderCredentials {
  readonly status: "pending" | "active" | "suspended";
  readonly scopes: readonly PushScope[];
  readonly signingKeys: readonly SigningKey[];
}

export interface PushCall {
  readonly senderId: string;
  readonly scope: PushScope;
  readonly request: PerimeterRequest;
  // WHY: the bytes as received, captured on the push path only; undefined on a POST means nothing can be verified.
  readonly rawBody: Buffer | undefined;
  readonly credentials: SenderCredentials | null;
}

export type PushAuthorization =
  | { readonly allowed: true; readonly keyId: string | null }
  | { readonly allowed: false; readonly reason: "unauthenticated" | "forbidden" };

export abstract class MiniAppPushAuthorizer {
  abstract authorize(call: PushCall): Promise<PushAuthorization>;
}

export type QuotaDecision = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

// WHY: taken once per send that reaches delivery: a refused draft or an idempotent repeat spends nothing.
export abstract class MiniAppPushQuota {
  abstract take(senderId: string): Promise<QuotaDecision>;
}

export interface NotificationDraft {
  title_ko?: unknown;
  body_ko?: unknown;
  title_en?: unknown;
  body_en?: unknown;
  actionType?: unknown;
  actionValue?: unknown;
}

export interface NotificationContent {
  title_ko: string;
  body_ko: string;
  title_en: string | null;
  body_en: string | null;
  actionType?: LinkActionType;
  actionValue?: string;
}

export type DraftCheck = { problems: string[] } | { content: NotificationContent };

export interface PushContentScope {
  readonly senderId: string;
  readonly gameIds: readonly string[];
  isKnownMiniAppTarget(value: string): boolean;
}

export abstract class PushContentPolicy {
  abstract check(draft: NotificationDraft, scope: PushContentScope): Promise<DraftCheck>;
}

// WHY: synchronous, because the CORS middleware asks it per request before any handler runs.
export abstract class OriginTrust {
  abstract isCorsOrigin(origin: string): boolean;
}

export const OUTBOUND_PURPOSES = ["notice-attachment"] as const;
export type OutboundPurpose = (typeof OUTBOUND_PURPOSES)[number];

export abstract class OutboundPolicy {
  abstract allows(purpose: OutboundPurpose, url: string): boolean;
  abstract requestConfig(purpose: OutboundPurpose): AxiosRequestConfig;
  abstract isBlocked(err: unknown): boolean;
}

export type AbuseSignal = {
  readonly kind: "auth.rejected" | "internal.rejected" | "push.refused" | "rate.limited";
  readonly request: PerimeterRequest;
  readonly principal?: Principal;
};

export abstract class AbuseSignals {
  abstract report(signal: AbuseSignal): void;
}

export interface PerimeterPorts {
  requestAuthenticator: RequestAuthenticator;
  rateLimitPolicy: RateLimitPolicy;
  internalAuthorizer: InternalAuthorizer;
  miniAppPushAuthorizer: MiniAppPushAuthorizer;
  miniAppPushQuota: MiniAppPushQuota;
  pushContentPolicy: PushContentPolicy;
  originTrust: OriginTrust;
  outboundPolicy: OutboundPolicy;
  abuseSignals: AbuseSignals;
}

export type PortName = keyof PerimeterPorts;

type PortToken<P> = abstract new (...args: never[]) => P;

export const PORT_TOKENS: { readonly [K in PortName]: PortToken<PerimeterPorts[K]> } = {
  requestAuthenticator: RequestAuthenticator,
  rateLimitPolicy: RateLimitPolicy,
  internalAuthorizer: InternalAuthorizer,
  miniAppPushAuthorizer: MiniAppPushAuthorizer,
  miniAppPushQuota: MiniAppPushQuota,
  pushContentPolicy: PushContentPolicy,
  originTrust: OriginTrust,
  outboundPolicy: OutboundPolicy,
  abuseSignals: AbuseSignals,
};

export const PORT_LABELS: { readonly [K in PortName]: string } = {
  requestAuthenticator: "REQUEST_AUTHENTICATOR",
  rateLimitPolicy: "RATE_LIMIT_POLICY",
  internalAuthorizer: "INTERNAL_AUTHORIZER",
  miniAppPushAuthorizer: "MINIAPP_PUSH_AUTHORIZER",
  miniAppPushQuota: "MINIAPP_PUSH_QUOTA",
  pushContentPolicy: "PUSH_CONTENT_POLICY",
  originTrust: "ORIGIN_TRUST",
  outboundPolicy: "OUTBOUND_POLICY",
  abuseSignals: "ABUSE_SIGNALS",
};

// WHY: shared by every process of the cluster, for low-volume quotas; never one write per request.
export interface PerimeterCounters {
  increment(key: string, windowSeconds: number): Promise<number>;
}

// WHY: what an implementation gets instead of importing config, the logger or the clock. A constructor reads only
// `logger`, `now`, `host` and `settings`: the poller constructs every class too, and `internalToken` throws there.
export interface PerimeterDeps {
  readonly logger: Logger;
  readonly now: () => Date;
  readonly host: string;
  readonly firebaseProjectId: string;
  readonly settings: string | undefined;
  readonly counters: PerimeterCounters;
  internalToken(scope: InternalScopeName): string;
}

export type PerimeterClasses = { readonly [K in PortName]: new (deps: PerimeterDeps) => PerimeterPorts[K] };

// WHY: the single opaque entry the registry loads in overlay mode; it names no private module.
export interface PerimeterOverlay {
  readonly portsVersion: number;
  readonly classes: PerimeterClasses;
  settingsErrors(settings: string | undefined): string[];
}
