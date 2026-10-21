import { Injectable } from "@nestjs/common";
import { BusScheduleService } from "../schedule/bus-schedule.service";
import { BusStopsService } from "../stops/bus-stops.service";
import type { FixedEstimate, ShuttleEtaDoc } from "./bus-eta.document";
import { BusEtaRepository } from "./bus-eta.repository";
import { runsOfDay, toEtaSequences, toSequenceLength } from "./bus-eta.rules";
import type { EtaRun, EtaSequence, SequenceLength, UpsertResult } from "./bus-eta.types";

interface EstimatedSequences {
  revision: number;
  sequences: readonly EtaSequence[];
  sequenceLength: SequenceLength;
}

@Injectable()
export class BusEtaService {
  // WHY: a reload every TTL finds the same bus-stops revision; its sequences are built once.
  private estimated: EstimatedSequences | null = null;

  constructor(
    private readonly repository: BusEtaRepository,
    private readonly schedule: BusScheduleService,
    private readonly stops: BusStopsService,
  ) {}

  // WHY: read on every tick, so a push reaches the pollers within the dataset TTL; it rejects while the stops were never read.
  async sequences(): Promise<readonly EtaSequence[]> {
    return (await this.current()).sequences;
  }

  // WHY: a document for an old stop count (the stops changed since its fetch) is dropped, so the pollers refetch
  // at once instead of waiting for the next 04:00 or departure; serving ignores it anyway.
  async listFitting(serviceIds: string[], dates: string[]): Promise<ShuttleEtaDoc[]> {
    const [{ sequenceLength }, docs] = await Promise.all([this.current(), this.repository.listEstimates(serviceIds, dates)]);
    return docs.filter((d) => d.offsetsSec.length === sequenceLength(d.serviceId, d.routeType));
  }

  async listFixedFitting(serviceIds: string[], dates: string[], now: Date): Promise<FixedEstimate[]> {
    const [{ sequenceLength }, fixed] = await Promise.all([this.current(), this.repository.listFixedEstimates(serviceIds, dates, now)]);
    return fixed.filter((d) => d.offsetsSec.length === sequenceLength(d.serviceId, d.routeType));
  }

  async upsertFitting(docs: ShuttleEtaDoc[]): Promise<UpsertResult> {
    return this.repository.upsertEstimates(docs, (await this.current()).sequenceLength);
  }

  // WHY: runs come from the resolved timetable, so an override, a rest day, a holiday or a suspension removes a
  // run here exactly as riders see it, and no directions call is made for a bus that does not run.
  async runsOn(sequence: EtaSequence, date: string): Promise<EtaRun[]> {
    const week = await this.schedule.resolveWeek(sequence.serviceId, date);
    const day = week?.days.find((d) => d.date === date);
    if (!day || (await this.schedule.isSuspendedOn(sequence.serviceId, date))) return [];
    return runsOfDay(day, { serviceId: sequence.serviceId, routeType: sequence.routeType, sequenceLength: sequence.stops.length });
  }

  async upcomingRuns(sequence: EtaSequence, now: Date): Promise<EtaRun[]> {
    const smart = await this.schedule.resolveSmartSchedule(sequence.serviceId);
    if (!smart || smart.status !== "active") return [];
    const ref = { serviceId: sequence.serviceId, routeType: sequence.routeType, sequenceLength: sequence.stops.length };
    return smart.days.flatMap((day) => runsOfDay(day, ref)).filter((run) => run.departAt.getTime() > now.getTime());
  }

  private async current(): Promise<EstimatedSequences> {
    const snapshot = await this.stops.current();
    if (snapshot.revision === this.estimated?.revision) return this.estimated;
    const sequences = toEtaSequences(snapshot.catalog, this.stops.etaOptIns());
    this.estimated = { revision: snapshot.revision, sequences, sequenceLength: toSequenceLength(sequences) };
    return this.estimated;
  }
}
