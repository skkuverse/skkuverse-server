// SEE: docs/decisions/0023-perimeter-ports.md ("D3. The mode check")
// WHY: imports nothing from src/infra/: config.ts runs this while it is itself loading.
import net from "node:net";
import { OVERLAY_ENTRY, overlayResolveErrors } from "./perimeter-overlay.rules";
import { PERIMETER_MODES, type PerimeterMode } from "./perimeter.ports";

const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

function isPerimeterMode(value: string): value is PerimeterMode {
  return (PERIMETER_MODES as readonly string[]).includes(value);
}

function isLoopbackAddress(address: string): boolean {
  const family = net.isIP(address);
  return family !== 0 && LOOPBACK.check(address, family === 4 ? "ipv4" : "ipv6");
}

function modeErrors(env: NodeJS.ProcessEnv): string[] {
  const mode = env.PERIMETER_MODE;
  if (!mode) return ["PERIMETER_MODE is required: overlay, local-dev or test, set per execution context"];
  if (!isPerimeterMode(mode)) return [`PERIMETER_MODE must be one of ${PERIMETER_MODES.join(" | ")} (got "${mode}")`];
  // WHY: the raw value, not envMode(): an unset NODE_ENV defaults to development there, and local-dev needs it explicit.
  if (mode === "local-dev" && env.NODE_ENV !== "development") {
    return [`PERIMETER_MODE=local-dev needs NODE_ENV=development set explicitly (got "${env.NODE_ENV ?? ""}")`];
  }
  if (mode === "test" && env.NODE_ENV === "production") return ["PERIMETER_MODE=test is refused in production"];
  return [];
}

// WHY: only the poller listens on nothing; an unknown ROLE is refused by roleErrors() on its own.
function hostErrors(env: NodeJS.ProcessEnv): string[] {
  const host = env.HOST;
  if (!host) return env.ROLE === "poller" ? [] : ["HOST is required where the server listens: 127.0.0.1 locally, 0.0.0.0 in a container"];
  if (net.isIP(host) === 0) return [`HOST must be an IP address (got "${host}")`];
  if (env.PERIMETER_MODE === "local-dev" && !isLoopbackAddress(host)) return [`PERIMETER_MODE=local-dev needs a loopback HOST (got "${host}")`];
  return [];
}

// WHY: resolves the entry without loading it: config.ts runs this before the error reporter starts.
export function perimeterModeErrors(env: NodeJS.ProcessEnv): string[] {
  const errors = [...modeErrors(env), ...hostErrors(env)];
  if (errors.length > 0 || env.PERIMETER_MODE !== "overlay") return errors;
  return overlayResolveErrors(() => require.resolve(OVERLAY_ENTRY));
}
