type Opaque =
  | readonly unknown[]
  | Date
  | ((...args: never[]) => unknown)
  | { readonly _bsontype: string }
  | { readonly __brand: string };

/**
 * A dotted path into T that ends at a string, a branded one included ("name.ko",
 * "spaceCd"). Arrays, dates, functions, number brands and BSON values such as ObjectId are not entered.
 */
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
