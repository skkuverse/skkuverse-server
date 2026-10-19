import type { ShellConfig } from "../miniapps.wire";

/** WHY: keyed by the origin, not a mini app id: a manifest belongs to the origin that serves it. */
export interface MiniAppManifestDoc {
  _id: string;
  shell: Partial<ShellConfig>;
  fetchedAt: Date;
}
