/**
 * Scripted BusEtaSmartService for the stop page: `getSmart` answers the smart schedule set in `schedules` for a
 * service, or rejects with the error `failWith` holds for it, or with the 404 the real one answers for a service it
 * has none of; `readServiceIds` records every read.
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

  async getSmart(serviceId: string, _lang: SupportedLang): Promise<WithEtag<SmartSchedule>> {
    this.readServiceIds.push(serviceId);
    const failure = this.failWith.get(serviceId);
    if (failure) throw failure;
    const schedule = this.schedules.get(serviceId);
    if (!schedule) throw new AppError("SERVICE_NOT_FOUND", `Unknown serviceId: ${serviceId}`, 404);
    return { data: structuredClone(schedule), etag: `"smart-${serviceId}"` };
  }
}
