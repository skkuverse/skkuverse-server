import fs from "node:fs";
import path from "node:path";
import { OVERLAY_ENTRY } from "../../../src/perimeter/perimeter-overlay.rules";
import { ROOT } from "./ratchet";
import { readSource } from "./tree";

const LOCAL_DEV = "src/perimeter/local-dev";

/**
 * The folders whose classes run every port's contract suite: the LocalDev classes, and the overlay's folder when
 * this checkout carries the entry's source. Found from OVERLAY_ENTRY, never named, so a public checkout without the
 * overlay still passes and one with it still checks it. The source file decides, not whether the entry resolves: a
 * Jest mapping may resolve the entry to a stand-in where the folder does not exist.
 */
export function implementationFolders(): string[] {
  const overlayFolder = path.relative(ROOT, path.dirname(OVERLAY_ENTRY)).split(path.sep).join("/");
  return fs.existsSync(`${OVERLAY_ENTRY}.ts`) ? [LOCAL_DEV, overlayFolder] : [LOCAL_DEV];
}

/** The specs directly in `folder` that call `suite` over an implementation, `describe<Port>Contract((deps) =>`. */
export function contractRunnersIn(folder: string, suite: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, folder))
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => `${folder}/${name}`)
    .filter((file) => readSource(file).includes(`${suite}((deps) =>`));
}
