/**
 * MiniappsCatalogClient with scripted manifest shell fields per mini app id,
 * already parsed (miniapps-catalog.client.spec.ts covers the fetch and the
 * parse). An id with no entry answers `{}`, as a mini app with no manifest
 * does. No prefetch, and `requests` records each id asked for.
 */
import type { MiniappsCatalogClient } from "../../../../src/miniapps/catalog/miniapps-catalog.client";
import type { MiniAppDetailRaw } from "../../../../src/miniapps/miniapps.schema";
import type { ShellConfig } from "../../../../src/miniapps/miniapps.wire";
import type { PublicOf } from "../public-of";

export class FakeMiniappsCatalogClient implements PublicOf<MiniappsCatalogClient> {
  shellFields: Record<string, Partial<ShellConfig>> = {};
  requests: string[] = [];

  onModuleInit(): void {}

  async fetchShellFields(detail: Pick<MiniAppDetailRaw, "id" | "startUrl">): Promise<Partial<ShellConfig>> {
    this.requests.push(detail.id);
    return { ...(this.shellFields[detail.id] ?? {}) };
  }
}
