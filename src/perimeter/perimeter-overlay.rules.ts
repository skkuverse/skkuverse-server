// SEE: docs/decisions/0023-perimeter-ports.md ("D4. One opaque overlay entry")
// WHY: imports nothing from src/infra/: config.ts resolves the entry while it is itself loading.
import path from "node:path";
import { PERIMETER_PORTS_VERSION, PORT_LABELS, PORT_NAMES, PORT_TOKENS, type PerimeterOverlay, type PortName } from "./perimeter.ports";

// WHY: no extension: Node resolves the compiled `.js` under dist/, Jest the `.ts` under src/.
export const OVERLAY_ENTRY = path.join(__dirname, "current", "perimeter.overlay");

export function overlayResolveErrors(resolve: () => string): string[] {
  try {
    resolve();
    return [];
  } catch {
    return [`PERIMETER_MODE=overlay needs its implementation entry, which does not resolve (${OVERLAY_ENTRY})`];
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extendsPort(name: PortName, value: unknown): boolean {
  return typeof value === "function" && value.prototype instanceof PORT_TOKENS[name];
}

function classErrors(classes: Record<string, unknown>): string[] {
  return PORT_NAMES
    .filter((name) => !extendsPort(name, classes[name]))
    .map((name) => `${PORT_LABELS[name]}: the entry has no class that extends the port`);
}

function overlayShapeErrors(entry: unknown): string[] {
  if (!isRecordValue(entry)) return ["the overlay entry exports no object"];
  const { portsVersion, classes, settingsErrors } = entry;
  if (portsVersion !== PERIMETER_PORTS_VERSION) {
    return [`the overlay entry is built against ports version ${String(portsVersion)}, this build is ${PERIMETER_PORTS_VERSION}`];
  }
  if (!isRecordValue(classes)) return ["the overlay entry exports no classes record"];
  if (typeof settingsErrors !== "function") return ["the overlay entry exports no settingsErrors function"];
  return classErrors(classes);
}

function settingsMessages(overlay: PerimeterOverlay, settings: string | undefined): string[] {
  const problems: unknown = overlay.settingsErrors(settings);
  if (!Array.isArray(problems)) return ["PERIMETER_SETTINGS: the entry's check returned no list"];
  return problems.map((problem) => `PERIMETER_SETTINGS: ${String(problem)}`);
}

export function overlayEntryErrors(entry: unknown, settings: string | undefined): string[] {
  const shape = overlayShapeErrors(entry);
  return shape.length > 0 ? shape : settingsMessages(entry as PerimeterOverlay, settings);
}

function requireOverlayEntry(): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the one module load by path (ADR 0023, D4)
  return require(OVERLAY_ENTRY);
}

export function loadOverlayEntry(): PerimeterOverlay {
  const entry = requireOverlayEntry();
  const errors = overlayShapeErrors(entry);
  if (errors.length > 0) throw new Error(`Invalid perimeter overlay:\n  ${errors.join("\n  ")}`);
  return entry as PerimeterOverlay;
}

export function perimeterOverlayErrors(env: NodeJS.ProcessEnv): string[] {
  if (env.PERIMETER_MODE !== "overlay") return [];
  try {
    return overlayEntryErrors(requireOverlayEntry(), env.PERIMETER_SETTINGS);
  } catch (err: unknown) {
    return [`the overlay entry failed to load: ${err instanceof Error ? err.message : String(err)}`];
  }
}
