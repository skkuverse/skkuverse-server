import { EXT_MIME, INLINE_SAFE_CONTENT_TYPE, MIME_TOP_LEVEL_TYPES, SANDBOX_CSP } from "./notices-attachment.constants";

// QUIRK(skku): school servers send attachments as application/octet-stream or application/unknown, so a generic
// type yields to the file extension's.
export function isSpecificContentType(upstreamCt: string | undefined): upstreamCt is string {
  if (!upstreamCt || upstreamCt === "application/unknown" || upstreamCt === "application/octet-stream") return false;
  return MIME_TOP_LEVEL_TYPES.has(upstreamCt.split("/")[0] ?? "");
}

export function resolveContentType(upstreamCt: string | undefined, filename: string): string {
  if (isSpecificContentType(upstreamCt)) return upstreamCt;
  const ext = (/\.[^.]+$/.exec(filename)?.[0] ?? "").toLowerCase();
  return EXT_MIME[ext] || upstreamCt || "application/octet-stream";
}

export function isInlineSafe(contentType: string): boolean {
  return INLINE_SAFE_CONTENT_TYPE.test(contentType);
}

export function toAttachmentFilename(url: string, name: string | undefined): string {
  return name || new URL(url).pathname.split("/").pop() || "attachment";
}

export function toAttachmentHeaders(mode: string | undefined, filename: string, upstreamCt: string | undefined): Array<[string, string]> {
  if (mode === "download") {
    return [
      ["Content-Type", "application/octet-stream"],
      ["Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`],
      ["X-Content-Type-Options", "nosniff"],
    ];
  }
  const contentType = resolveContentType(upstreamCt, filename);
  return [
    ["Content-Type", contentType],
    ["Content-Disposition", "inline"],
    ...(isInlineSafe(contentType) ? [] : [["Content-Security-Policy", SANDBOX_CSP] as [string, string]]),
    ["X-Content-Type-Options", "nosniff"],
  ];
}

export function toSessionId(setCookie: readonly string[]): string | null {
  for (const cookie of setCookie) {
    const match = /PHPSESSID=([^;]+)/.exec(cookie);
    if (match) return match[1] ?? null;
  }
  return null;
}
