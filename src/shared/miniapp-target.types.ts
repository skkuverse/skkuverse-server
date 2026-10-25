export interface MiniAppTarget {
  id: string;
  /** WHY: root-relative, on the mini app's registered origin; absent means its startUrl. */
  path?: string;
}
