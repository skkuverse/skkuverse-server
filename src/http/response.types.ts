import type { SupportedLang } from "../infra/types";

export interface SuccessEnvelope {
  readonly meta: { readonly lang?: SupportedLang } & Readonly<Record<string, unknown>>;
  readonly data: unknown;
}

export type SuccessMeta = Readonly<Record<string, unknown>> & { readonly lang?: never };

export interface WithMeta<T, M extends SuccessMeta> {
  readonly data: T;
  readonly meta: M;
}

export interface WithEtag<T> {
  readonly data: T;
  readonly etag: string;
  /** WHY: for a Cache-Control that depends on the value; a fixed one is the handler's @CacheControl. */
  readonly cacheControl?: string;
}
