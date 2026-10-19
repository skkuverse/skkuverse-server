import { Injectable } from "@nestjs/common";
import { isRecord } from "../../shared/object.util";
import { parseShellFields } from "../miniapps.mapper";
import type { ShellConfig } from "../miniapps.wire";
import { FETCH_TIMEOUT_MS, MANIFEST_PATH, MAX_MANIFEST_BYTES } from "./miniapps-manifest.constants";

@Injectable()
export class MiniappsManifestClient {
  // WHY: throws on anything untrustworthy, so the caller keeps its last good value instead of an empty one.
  async fetchShellFields(origin: string): Promise<Partial<ShellConfig>> {
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
