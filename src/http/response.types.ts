/** A handler's value plus extra `meta` keys, as withMeta() builds it for ResponseInterceptor. */
export interface WithMeta<T> {
  readonly data: T;
  readonly meta: Readonly<Record<string, unknown>>;
}
