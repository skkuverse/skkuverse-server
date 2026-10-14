import { Injectable, type OnModuleInit } from "@nestjs/common";
import { createCachedLoader, type CachedLoader } from "../../infra/cached-loader";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { FIRST_PARTY_MINIAPP_ORIGINS } from "../../infra/origins";
import { isRecord } from "../../shared/object.util";
import type { MiniAppDetailRaw } from "../miniapps.schema";
import { MiniappsService } from "../miniapps.service";
import type { ShellConfig } from "../miniapps.wire";
import {
  CACHE_TTL_MS,
  FETCH_FAILED_LOG_INTERVAL_MS,
  FETCH_TIMEOUT_MS,
  MANIFEST_PATH,
  MAX_MANIFEST_BYTES,
} from "./miniapps-catalog.constants";
import { parseShellFields } from "./miniapps-catalog.mapper";
import { firstPartyOrigin } from "./miniapps-catalog.rules";

// WHY: once a manifest has loaded, a mini app's own outage must never fail or hang its own detail.
const STALE_FOREVER_MS = Number.MAX_SAFE_INTEGER;

type ShellFields = Partial<ShellConfig>;

@Injectable()
export class MiniappsCatalogClient implements OnModuleInit {
  private readonly loaders = new Map<string, CachedLoader<ShellFields>>();
  private readonly fetchFailedThrottle = createLogThrottle(FETCH_FAILED_LOG_INTERVAL_MS);

  constructor(private readonly miniApps: MiniappsService) {}

  // WHY: fire-and-forget, so the boot never waits on a network call, and one mini app down stops no other's prefetch.
  onModuleInit(): void {
    for (const detail of this.miniApps.map.values()) {
      const origin = firstPartyOrigin(detail.startUrl, FIRST_PARTY_MINIAPP_ORIGINS);
      if (!origin) continue;
      this.loaderFor(detail.id, origin)
        .get()
        .catch((err: unknown) => {
          logger.warn(
            { event: "miniapps.manifest.prefetch_failed", miniAppId: detail.id, origin, err },
            "Manifest prefetch failed; serving the registry's own shell for now",
          );
        });
    }
  }

  // WHY: `{}` merges as no override, so a mini app with no manifest, or one failing, keeps the registry's shell.
  async fetchShellFields(detail: Pick<MiniAppDetailRaw, "id" | "startUrl">): Promise<ShellFields> {
    const origin = firstPartyOrigin(detail.startUrl, FIRST_PARTY_MINIAPP_ORIGINS);
    if (!origin) return {};
    try {
      return await this.loaderFor(detail.id, origin).get();
    } catch (err) {
      this.warnFetchFailed(detail.id, origin, err);
      return {};
    }
  }

  private warnFetchFailed(miniAppId: string, origin: string, err: unknown): void {
    const ticket = this.fetchFailedThrottle.take(miniAppId);
    if (!ticket) return;
    logger.warn(
      { event: "miniapps.manifest.fetch_failed", miniAppId, origin, err, suppressed: ticket.suppressed },
      "Manifest fetch failed; serving the registry's own shell",
    );
  }

  private loaderFor(id: string, origin: string): CachedLoader<ShellFields> {
    const existing = this.loaders.get(id);
    if (existing) return existing;
    const loader = createCachedLoader<ShellFields>({
      name: `miniapp-manifest:${id}`,
      ttlMs: CACHE_TTL_MS,
      staleWindowMs: STALE_FOREVER_MS,
      load: () => this.fetchManifest(origin),
      // WHY: the manifest is on the mini app's production origin, not in a _dev database; uncached, every open waits on it.
      keepWhenCacheOff: true,
    });
    this.loaders.set(id, loader);
    return loader;
  }

  // WHY: throws on anything untrustworthy, so the loader keeps its last good value instead of an empty one.
  private async fetchManifest(origin: string): Promise<ShellFields> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${origin}${MANIFEST_PATH}`, { redirect: "manual", signal: controller.signal });
      this.assertReadable(res, origin);
      const json: unknown = JSON.parse(await this.readBounded(res));
      return parseShellFields(isRecord(json) ? json.shell : undefined);
    } finally {
      clearTimeout(timer);
    }
  }

  // WHY: a manual redirect answers with an opaque status-0 response, and a test double with the raw 3xx: both refused.
  private assertReadable(res: Response, origin: string): void {
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      throw new Error(`manifest redirected from ${origin}`);
    }
    if (!res.ok) throw new Error(`manifest ${res.status} from ${origin}`);
    const contentLength = res.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_MANIFEST_BYTES) {
      throw new Error(`manifest content-length exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
  }

  // WHY: a Content-Length can lie or be absent (chunked), so the bytes actually read are bounded too.
  private async readBounded(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return res.text();
    try {
      return await this.readChunks(reader);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  private async readChunks(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      total += next.value.byteLength;
      if (total > MAX_MANIFEST_BYTES) throw new Error(`manifest body exceeds ${MAX_MANIFEST_BYTES} bytes`);
      chunks.push(next.value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }
}
