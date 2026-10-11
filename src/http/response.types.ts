export type SuccessMeta = Readonly<Record<string, unknown>> & { readonly lang?: never };

export interface WithMeta<T, M extends SuccessMeta> {
  readonly data: T;
  readonly meta: M;
}
