export interface JongroBusSighting {
  stationId: string;
  latitude: string;
  longitude: string;
  carNumber: string;
}

export interface JongroBusDwell {
  recordTime: string;
  estimatedTime: number;
}

export interface MismatchedStop {
  staOrd: string;
  stId: string;
  stNm: string;
  expected: string | null;
}

export interface MissingStop {
  staOrd: string;
  topisId: string;
  stationName: string;
}

export interface RenamedStop {
  staOrd: string;
  stNm: string;
  registryName: string;
}

export interface RegistryDrift {
  mismatched: MismatchedStop[];
  missing: MissingStop[];
  renamed: RenamedStop[];
}
