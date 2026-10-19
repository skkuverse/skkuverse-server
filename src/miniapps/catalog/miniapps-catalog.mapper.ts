import { isRecord } from "../../shared/object.util";
import { parseShellFields } from "../miniapps.mapper";
import type { MiniAppDetailRaw } from "../miniapps.schema";
import type { MiniAppDetail, ShellConfig } from "../miniapps.wire";
import { DEFAULT_SHELL } from "./miniapps-catalog.constants";
import type { Manifest } from "./miniapps-catalog.types";

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
