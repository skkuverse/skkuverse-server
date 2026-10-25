// SEE: docs/decisions/0023-perimeter-ports.md ("D4. One opaque overlay entry") — where each mode's implementations
// come from; PerimeterModule constructs them once per process.
import { LOCAL_DEV_CLASSES } from "./local-dev/perimeter-classes";
import { loadOverlayEntry } from "./perimeter-overlay.rules";
import { PORT_LABELS, PORT_TOKENS, type PerimeterClasses, type PerimeterMode, type PerimeterPorts, type PortName } from "./perimeter.ports";

// WHY: a record per port, so a method added to a port fails the type check here until its stub throws too.
const PORT_METHODS: { readonly [K in PortName]: Readonly<Record<keyof PerimeterPorts[K], true>> } = {
  requestAuthenticator: { authenticate: true },
  rateLimitPolicy: { handlerFor: true },
  internalAuthorizer: { authorize: true },
  miniAppPushAuthorizer: { authorize: true },
  miniAppPushQuota: { take: true },
  pushContentPolicy: { check: true },
  originTrust: { isCorsOrigin: true },
  outboundPolicy: { allows: true, requestConfig: true, isBlocked: true },
  abuseSignals: { report: true },
};

export function perimeterClassesFor(mode: Exclude<PerimeterMode, "test">): PerimeterClasses {
  return mode === "overlay" ? loadOverlayEntry().classes : LOCAL_DEV_CLASSES;
}

// WHY: a stub, not a default implementation, so a route test that reaches a port without its fake fails naming it.
export function toTestStub<K extends PortName>(name: K): PerimeterPorts[K] {
  const stub = Object.create(PORT_TOKENS[name].prototype as object) as Record<string, unknown>;
  for (const method of Object.keys(PORT_METHODS[name])) {
    stub[method] = () => {
      throw new Error(`${PORT_LABELS[name]}.${method} has no implementation under PERIMETER_MODE=test: pass its fake in buildTestApp's overrides`);
    };
  }
  return stub as unknown as PerimeterPorts[K];
}
