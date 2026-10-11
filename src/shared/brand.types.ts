// WHY: two IDs of one primitive, such as a building number and a room code, cannot be passed for each
// other. The brand exists only in types; a value gets it where it enters (a .client, .schema or .rules file).
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
