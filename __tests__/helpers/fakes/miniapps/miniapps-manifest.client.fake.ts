/**
 * MiniappsManifestClient with scripted shell fields per origin, already parsed
 * (miniapps-manifest.client.spec.ts covers the fetch and the parse). An origin
 * with no entry answers `{}`, as a manifest with no shell does; an Error in its
 * place rejects, as a failed fetch does. `calls` records each origin asked for.
 */
import type { MiniappsManifestClient } from "../../../../src/miniapps/manifest/miniapps-manifest.client";
import type { ShellConfig } from "../../../../src/miniapps/miniapps.wire";
import type { PublicOf } from "../public-of";

export class FakeMiniappsManifestClient implements PublicOf<MiniappsManifestClient> {
  answers = new Map<string, Partial<ShellConfig> | Error>();
  calls: string[] = [];

  async fetchShellFields(origin: string): Promise<Partial<ShellConfig>> {
    this.calls.push(origin);
    const answer = this.answers.get(origin) ?? {};
    if (answer instanceof Error) throw answer;
    return { ...answer };
  }
}
