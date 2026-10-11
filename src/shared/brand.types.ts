// WHY: two IDs of one primitive, such as a building number and a room code, cannot be passed for each
// other. The brand exists only in types; a value gets it only from the brand's one minter, in the
// .rules file of the folder that declares it (ADR 0010, D4).
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
