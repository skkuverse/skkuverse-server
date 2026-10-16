export interface SeoulLine {
  subwayId: string;
  lineName: string;
  trainMapLine: string;
  stationNames: readonly string[];
  stationIdByName: ReadonlyMap<string, string>;
}
