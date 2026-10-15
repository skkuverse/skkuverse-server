import type { Readable } from "stream";

export interface AttachmentUpstream {
  contentType: string | undefined;
  contentLength: number | undefined;
  body: Readable;
}

export interface AttachmentDownload {
  headers: Array<[string, string]>;
  body: Readable;
}

export interface AttachmentLog {
  warn(fields: Record<string, unknown>, message: string): void;
}
