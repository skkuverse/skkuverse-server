/**
 * Scripted BusEtaSmartService for the stop page: `resolveSmart` answers the smart schedule set in `schedules` for a
 * service, or rejects with the error `failWith` holds for it, or with the 404 the real one answers for a service it
 * has none of; `readServiceIds` records every read. `getSmart` answers the same with an ETag, and records its reads
 * in `etagReadServiceIds` apart, so a test can tell which one a caller paid for.
 */
import { AppError } from "../../../../src/http/app.error";
import type { WithEtag } from "../../../../src/http/response.types";
import type { SupportedLang } from "../../../../src/infra/types";
import type { BusEtaSmartService } from "../../../../src/bus/eta/smart/bus-eta-smart.service";
import type { SmartSchedule } from "../../../../src/bus/schedule/bus-schedule.wire";
import type { PublicOf } from "../public-of";

export class FakeBusEtaSmartService implements PublicOf<BusEtaSmartService> {
  schedules = new Map<string, SmartSchedule>();
  failWith = new Map<string, Error>();
  readServiceIds: string[] = [];
  etagReadServiceIds: string[] = [];

  async getSmart(serviceId: string, _lang: SupportedLang): Promise<WithEtag<SmartSchedule>> {
    this.etagReadServiceIds.push(serviceId);
    return { data: this.scheduleOf(serviceId), etag: `"smart-${serviceId}"` };
  }

  async resolveSmart(serviceId: string, _lang: SupportedLang): Promise<SmartSchedule> {
    this.readServiceIds.push(serviceId);
    return this.scheduleOf(serviceId);
  }

  private scheduleOf(serviceId: string): SmartSchedule {
    const failure = this.failWith.get(serviceId);
    if (failure) throw failure;
    const schedule = this.schedules.get(serviceId);
    if (!schedule) throw new AppError("SERVICE_NOT_FOUND", `Unknown serviceId: ${serviceId}`, 404);
    return structuredClone(schedule);
  }
}
