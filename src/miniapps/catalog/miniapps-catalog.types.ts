import type { ShellConfig } from "../miniapps.wire";

/** WHY: the part of the @skkuverse/miniapp SDK manifest this server reads; the rest is the app's. */
export interface Manifest {
  shell: ShellConfig;
}
