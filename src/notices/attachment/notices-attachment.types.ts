import type { Readable } from "stream";

export interface AttachmentUpstream {
  headers: Record<string, unknown>;
  data: Readable;
}

export interface AttachmentRequest {
  url?: string;
  referer?: string;
  mode?: string;
  name?: string;
}

export interface AttachmentDelivery {
  url: string;
  name: string | undefined;
  mode: string | undefined;
}
