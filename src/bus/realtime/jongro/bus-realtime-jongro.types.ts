export interface JongroBusSighting {
  stationId: string;
  latitude: string;
  longitude: string;
  carNumber: string;
}

/** WHY: since when a bus has been at its last passed station (ISO instant), and for how many seconds. */
export interface JongroBusDwell {
  firstSeenAt: string;
  dwellSeconds: number;
}

export interface MismatchedStation {
  staOrd: string;
  stId: string;
  stNm: string;
  expected: string | null;
}

export interface MissingStation {
  staOrd: string;
  topisId: string;
  stationName: string;
}

export interface RenamedStation {
  staOrd: string;
  stNm: string;
  registryName: string;
}

export interface RegistryDrift {
  mismatched: MismatchedStation[];
  missing: MissingStation[];
  renamed: RenamedStation[];
}
