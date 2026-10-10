/**
 * A primitive the compiler tells apart from others of the same kind: a
 * building number and a room code are both strings, but a `BuildNo` cannot
 * be passed where a `SpaceCd` is expected. The brand exists only in types;
 * at runtime the value is the plain primitive. A value gets its brand where
 * it enters the system: the client that translates the upstream payload,
 * the schema that parses a request, or the rule that derives it.
 */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
