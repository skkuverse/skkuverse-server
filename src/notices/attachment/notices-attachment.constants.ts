// WHY: per-transfer caps enforced while piping: axios ignores maxContentLength for a stream, and its socket
// timeout stops applying once the response resolves.
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const IDLE_TRANSFER_MS = 30_000;
export const MAX_TRANSFER_MS = 10 * 60_000;

export const UPSTREAM_TIMEOUT_MS = 15_000;
export const SESSION_TIMEOUT_MS = 10_000;
export const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;

export const UPSTREAM_USER_AGENT = "Mozilla/5.0";

export const SANDBOX_CSP = "sandbox; default-src 'none'";

export const EXT_MIME: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".hwp": "application/x-hwp",
  ".hwpx": "application/x-hwpx",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

export const MIME_TOP_LEVEL_TYPES: ReadonlySet<string> = new Set([
  "application",
  "text",
  "image",
  "audio",
  "video",
  "font",
  "multipart",
  "message",
]);

// WHY: an allowlist of types safe to render inline on this origin; anything else inline gets the sandbox CSP,
// because the set of types a browser will execute is open-ended.
export const INLINE_SAFE_CONTENT_TYPE = /^\s*(application\/pdf|image\/(png|jpeg|gif|webp|bmp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+)\s*(;|$)/i;
