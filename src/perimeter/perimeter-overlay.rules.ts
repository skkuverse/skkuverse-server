// SEE: docs/decisions/0023-perimeter-ports.md ("D4. One opaque overlay entry")
// WHY: imports nothing from src/infra/: config.ts resolves the entry while it is itself loading.
import path from "node:path";
import {
  PERIMETER_PORTS_VERSION,
  PERIMETER_SETTINGS_RE,
  PORT_LABELS,
  PORT_NAMES,
  PORT_TOKENS,
  type PerimeterClasses,
  type PerimeterOverlay,
  type PerimeterDeps,
  type PortName,
} from "./perimeter.ports";

// WHY: no extension: Node resolves the compiled `.js` under dist/, Jest the `.ts` under src/.
export const OVERLAY_ENTRY = path.join(__dirname, "..", "private", "perimeter.overlay");

type ParsedOverlay = { readonly overlay: PerimeterOverlay } | { readonly errors: string[] };

export function overlayResolveErrors(): string[] {
  try {
    require.resolve(OVERLAY_ENTRY);
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
  return PORT_NAMES.filter((name) => !extendsPort(name, classes[name])).map((name) => `${PORT_LABELS[name]}: the entry has no class that extends the port`);
}

function isPerimeterClasses(classes: Record<string, unknown>): classes is PerimeterClasses {
  return classErrors(classes).length === 0;
}

function isOverlayCheck(value: unknown): value is PerimeterOverlay["settingsErrors"] {
  return typeof value === "function";
}

function parseOverlayEntry(entry: unknown): ParsedOverlay {
  if (!isRecordValue(entry)) return { errors: ["the overlay entry exports no object"] };
  const { portsVersion, classes, settingsErrors } = entry;
  if (portsVersion !== PERIMETER_PORTS_VERSION) {
    return { errors: [`the overlay entry is built against ports version ${String(portsVersion)}, this build is ${PERIMETER_PORTS_VERSION}`] };
  }
  if (!isRecordValue(classes)) return { errors: ["the overlay entry exports no classes record"] };
  if (!isOverlayCheck(settingsErrors)) return { errors: ["the overlay entry exports no settingsErrors function"] };
  if (!isPerimeterClasses(classes)) return { errors: classErrors(classes) };
  return { overlay: { portsVersion, classes, settingsErrors } };
}

export function perimeterSettingsOf(env: NodeJS.ProcessEnv): PerimeterDeps["settings"] {
  const sections = Object.entries(env).filter((entry): entry is [string, string] => PERIMETER_SETTINGS_RE.test(entry[0]) && Boolean(entry[1]));
  return Object.freeze(Object.fromEntries(sections));
}

export function overlayEntryErrors(entry: unknown, settings: PerimeterDeps["settings"]): string[] {
  const parsed = parseOverlayEntry(entry);
  if ("errors" in parsed) return parsed.errors;
  const problems: unknown = parsed.overlay.settingsErrors(settings);
  if (!Array.isArray(problems)) return ["the entry's settingsErrors returned no list"];
  return problems.map(String);
}

function requireOverlayEntry(): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the one module load by path (ADR 0023, D4)
  return require(OVERLAY_ENTRY);
}

export function loadOverlayEntry(): PerimeterOverlay {
  const parsed = parseOverlayEntry(requireOverlayEntry());
  if ("errors" in parsed) throw new Error(`Invalid perimeter overlay:\n  ${parsed.errors.join("\n  ")}`);
  return parsed.overlay;
}

export function perimeterOverlayErrors(env: NodeJS.ProcessEnv): string[] {
  if (env.PERIMETER_MODE !== "overlay") return [];
  try {
    return overlayEntryErrors(requireOverlayEntry(), perimeterSettingsOf(env));
  } catch (err: unknown) {
    return [`the overlay entry failed to load: ${err instanceof Error ? err.message : String(err)}`];
  }
}
