type Opaque =
  | readonly unknown[]
  | Date
  | ((...args: never[]) => unknown)
  | { readonly _bsontype: string }
  | { readonly __brand: string };

export type StringPath<T, Depth extends unknown[] = []> = Depth["length"] extends 3
  ? never
  : {
      [K in keyof T & string]-?: NonNullable<T[K]> extends string
        ? K
        : NonNullable<T[K]> extends Opaque
          ? never
          : NonNullable<T[K]> extends object
            ? `${K}.${StringPath<NonNullable<T[K]>, [...Depth, unknown]>}`
            : never;
    }[keyof T & string];
