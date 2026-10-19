import { Injectable } from "@nestjs/common";
import { BusScheduleService } from "../schedule/bus-schedule.service";
import { BusStopsService } from "../stops/bus-stops.service";
import type { FixedEstimate, ShuttleEtaDoc } from "./bus-eta.document";
import { BusEtaRepository } from "./bus-eta.repository";
import { runsOfDay, toEtaSequences, toSequenceLength } from "./bus-eta.rules";
import type { EtaRun, EtaSequence, SequenceLength, UpsertResult } from "./bus-eta.types";

@Injectable()
export class BusEtaService {
  private readonly etaSequences: EtaSequence[];
  private readonly sequenceLength: SequenceLength;

  constructor(
    private readonly repository: BusEtaRepository,
    private readonly schedule: BusScheduleService,
    stops: BusStopsService,
  ) {
    this.etaSequences = toEtaSequences(stops.catalog(), stops.etaOptIns());
    this.sequenceLength = toSequenceLength(this.etaSequences);
  }

  sequences(): readonly EtaSequence[] {
    return this.etaSequences;
  }

  // WHY: a document for an old stop count (the catalog changed since its fetch) is dropped, so the pollers refetch
  // at once instead of waiting for the next 04:00 or departure; serving ignores it anyway.
  async listFitting(serviceIds: string[], dates: string[]): Promise<ShuttleEtaDoc[]> {
    const docs = await this.repository.listEstimates(serviceIds, dates);
    return docs.filter((d) => d.offsetsSec.length === this.sequenceLength(d.serviceId, d.routeType));
  }

  async listFixedFitting(serviceIds: string[], dates: string[], now: Date): Promise<FixedEstimate[]> {
    const fixed = await this.repository.listFixedEstimates(serviceIds, dates, now);
    return fixed.filter((d) => d.offsetsSec.length === this.sequenceLength(d.serviceId, d.routeType));
  }

  upsertFitting(docs: ShuttleEtaDoc[]): Promise<UpsertResult> {
    return this.repository.upsertEstimates(docs, this.sequenceLength);
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
    return smart.days
      .flatMap((day) => runsOfDay(day, { serviceId: sequence.serviceId, routeType: sequence.routeType, sequenceLength: sequence.stops.length }))
      .filter((run) => run.departAt.getTime() > now.getTime());
  }
}
