// WHY: detail's projection: it serves `extensions` (always {}) as production does, and dropping it
// is a behavior change of its own (define-boundary-contracts design, Q5).
export const SERVED_BUILDING_WITH_EXTENSIONS_PROJECTION = { sync: 0, enrichVersion: 0 } as const;
