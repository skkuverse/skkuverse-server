export type SuccessMeta = Readonly<Record<string, unknown>> & { readonly lang?: never };

export interface WithMeta<T> {
  readonly data: T;
  readonly meta: SuccessMeta;
}
