import { isRecord } from "../../shared/object.util";
import { SHELL_BACKGROUND_RE, SHELL_BARS, SHELL_HEADERS, SHELL_STATUS_BARS } from "../miniapps.constants";
import type { MiniAppDetailRaw } from "../miniapps.schema";
import type { MiniAppDetail, ShellConfig } from "../miniapps.wire";
import { DEFAULT_SHELL } from "./miniapps-catalog.constants";
import type { Manifest } from "./miniapps-catalog.types";

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined => allowed.find((option) => option === value);

/**
 * WHY: a copy of the @skkuverse/miniapp SDK's tolerant manifest parse (that package is ESM-only, this server
 * CommonJS), kept in step by hand: a bad value is dropped, and the default takes its place.
 */
export function parseShellFields(value: unknown): Partial<ShellConfig> {
  if (!isRecord(value)) return {};
  const bar = pick(value.bar, SHELL_BARS);
  const header = pick(value.header, SHELL_HEADERS);
  const statusBar = pick(value.statusBar, SHELL_STATUS_BARS);
  const background = typeof value.background === "string" && SHELL_BACKGROUND_RE.test(value.background) ? value.background : undefined;
  return {
    ...(bar ? { bar } : {}),
    ...(header ? { header } : {}),
    ...(statusBar ? { statusBar } : {}),
    ...(background ? { background: background.toUpperCase() } : {}),
  };
}

export function mergeShell(base: ShellConfig, over: Partial<ShellConfig>): ShellConfig {
  return { ...base, ...over };
}

export function parseManifest(value: unknown): Manifest {
  const shell = isRecord(value) ? parseShellFields(value.shell) : {};
  return { shell: mergeShell(DEFAULT_SHELL, shell) };
}

// WHY: the defaults, under the registry's own fields, under the mini app's manifest: the manifest wins.
export function toDetailResponse(detail: Readonly<MiniAppDetailRaw>, manifestFields: Partial<ShellConfig>): MiniAppDetail {
  const shell = mergeShell(mergeShell(DEFAULT_SHELL, parseShellFields(detail.shell)), manifestFields);
  return { ...detail, shell };
}
