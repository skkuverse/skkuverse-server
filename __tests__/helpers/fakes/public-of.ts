/**
 * The public members of a class: what a typed fake implements. A class's own
 * type cannot be implemented by another class once it has private fields, and
 * `keyof` sees only public members, so a method added to or renamed in the real
 * class breaks `npm run typecheck` here instead of a test at run time. Each
 * method is restated as a function type because TypeScript checks method
 * parameters bivariantly: a real method that starts accepting more (a new
 * `"all"` campus) would otherwise still type-check against a fake that cannot
 * handle it.
 */
export type PublicOf<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : T[K];
};

/**
 * A fake where the real class is expected, as in a constructor argument. A class
 * with private fields admits no other implementation, but a caller can only
 * reach its public members, which PublicOf has already checked.
 */
export function asReal<T>(fake: PublicOf<T>): T {
  return fake as T;
}
