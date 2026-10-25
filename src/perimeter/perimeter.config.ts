import type { Provider } from "@nestjs/common";
import { Clock } from "../infra/clock";
import config from "../infra/config";
import logger from "../infra/logger";
import { PerimeterCountersRepository } from "./perimeter-counters.repository";
import { perimeterClassesFor, toTestStub } from "./perimeter-registry.rules";
import { PORT_NAMES, PORT_TOKENS, type InternalScopeName, type PerimeterClasses, type PerimeterDeps, type PerimeterMode, type PortName } from "./perimeter.ports";

const PERIMETER_DEPS = "PERIMETER_DEPS";
const PERIMETER_CLASSES = "PERIMETER_CLASSES";

// WHY: read per call, never at construction: the poller builds every class and holds no internal token (ADR 0012, D4).
const INTERNAL_TOKEN_BY_SCOPE: { readonly [S in InternalScopeName]: () => string } = {
  "notices.dispatch": () => config.notices.dispatch.internalToken,
  "subway.accuracy": () => config.subway.accuracyToken,
};

function perimeterDeps(counters: PerimeterCountersRepository, clock: Clock): PerimeterDeps {
  return {
    logger,
    now: () => clock.now(),
    host: config.role() === "poller" ? null : config.host,
    firebaseProjectId: config.firebase.projectId,
    settings: config.perimeter.settings,
    counters: { increment: (key, windowSeconds) => counters.upsertCount(key, windowSeconds) },
    internalToken: (scope) => INTERNAL_TOKEN_BY_SCOPE[scope](),
  };
}

function portProvider(name: PortName): Provider {
  return {
    provide: PORT_TOKENS[name],
    useFactory: (classes: PerimeterClasses, deps: PerimeterDeps) => new classes[name](deps),
    inject: [PERIMETER_CLASSES, PERIMETER_DEPS],
  };
}

// WHY: test mode builds no deps and no counters, so a route test boots no Mongo index and reads no token.
export function perimeterProviders(mode: PerimeterMode): Provider[] {
  if (mode === "test") return PORT_NAMES.map((name) => ({ provide: PORT_TOKENS[name], useValue: toTestStub(name) }));
  return [
    Clock,
    PerimeterCountersRepository,
    { provide: PERIMETER_DEPS, useFactory: perimeterDeps, inject: [PerimeterCountersRepository, Clock] },
    { provide: PERIMETER_CLASSES, useFactory: () => perimeterClassesFor(mode) },
    ...PORT_NAMES.map(portProvider),
  ];
}
