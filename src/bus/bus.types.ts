export interface TransferLine {
  line: string;
  color: string;
}

export interface JongroStation {
  sequence: string;
  stationName: string;
  stationNumber: string | null;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  transferLines: TransferLine[];
}

export interface JongroStationMapping {
  [topisId: string]: {
    sequence: number;
    stationName: string;
  };
}

export interface JongroRoute {
  readonly id: string;
  readonly code: string;
  readonly busRouteId: string;
  readonly themeColor: string;
  readonly iconType: string;
  readonly refreshInterval: number;
  readonly arrivalsUrl: string;
  readonly positionsUrl: string;
  readonly stations: ReadonlyArray<JongroStation>;
  readonly mapping: Readonly<JongroStationMapping>;
  readonly topisIds: ReadonlyArray<string>;
}
