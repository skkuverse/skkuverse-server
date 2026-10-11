// WHY: detail's projection: it serves `extensions` (always {}) as production does, and dropping it
// is a behavior change of its own (define-boundary-contracts design, Q5).
const SERVED_BUILDING_WITH_EXTENSIONS_PROJECTION = { sync: 0, enrichVersion: 0 } as const;

/** WHY: `sync` and `enrichVersion` are the sync's bookkeeping, `extensions` an empty placeholder. */
const SERVED_BUILDING_PROJECTION = { ...SERVED_BUILDING_WITH_EXTENSIONS_PROJECTION, extensions: 0 } as const;

export { SERVED_BUILDING_PROJECTION, SERVED_BUILDING_WITH_EXTENSIONS_PROJECTION };
