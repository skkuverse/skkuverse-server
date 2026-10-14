
// WHY: `Object.hasOwn`: an ops-typed category such as "constructor" would otherwise resolve to a prototype member.
export function presentationFor<P>(config: { itemDefaults: { byCategory: Record<string, P>; fallback: P } }, category: string): P {
  const { byCategory, fallback } = config.itemDefaults;
  return (Object.hasOwn(byCategory, category) ? byCategory[category] : undefined) ?? fallback;
}
