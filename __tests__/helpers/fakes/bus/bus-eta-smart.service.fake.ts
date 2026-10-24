/**
 * Scripted BusEtaSmartService for the stop page: `listRuns` answers the run list set in `runLists` for a service
 * (the shown week), with the runs set in `followingRuns` appended for two weeks when it is active, each kept only
 * while under way at `from` as the real read keeps it; or it rejects with the error `failWith` holds for the service,
 * or with the 404 the real one answers for a service it has none of. It records a one-week read in `readServiceIds`
 * and a two-week read in `followingReadServiceIds`. `getSmart` answers the smart schedule set in `schedules` with an
 * ETag, and records its reads in `etagReadServiceIds` apart, so a test can tell which one a caller paid for.
 */
import { isUnderWayAt } from "../../../../src/bus/eta/smart/bus-eta-smart.rules";
import type { BusEtaSmartService } from "../../../../src/bus/eta/smart/bus-eta-smart.service";
import type { RunList, RunWindow, ShuttleRun } from "../../../../src/bus/eta/smart/bus-eta-smart.types";
import type { SmartSchedule } from "../../../../src/bus/schedule/bus-schedule.wire";
import { AppError } from "../../../../src/http/app.error";
import type { WithEtag } from "../../../../src/http/response.types";
import type { SupportedLang } from "../../../../src/infra/types";
import type { PublicOf } from "../public-of";

export class FakeBusEtaSmartService implements PublicOf<BusEtaSmartService> {
  schedules = new Map<string, SmartSchedule>();
  runLists = new Map<string, RunList>();
  followingRuns = new Map<string, ShuttleRun[]>();
  failWith = new Map<string, Error>();
  readServiceIds: string[] = [];
  followingReadServiceIds: string[] = [];
  etagReadServiceIds: string[] = [];

  async getSmart(serviceId: string, _lang: SupportedLang): Promise<WithEtag<SmartSchedule>> {
    this.etagReadServiceIds.push(serviceId);
    const schedule = this.schedules.get(serviceId);
    if (!schedule) throw new AppError("SERVICE_NOT_FOUND", `Unknown serviceId: ${serviceId}`, 404);
    return { data: structuredClone(schedule), etag: `"smart-${serviceId}"` };
  }

  async listRuns(serviceId: string, { from, weekCount }: RunWindow): Promise<RunList> {
    (weekCount === 2 ? this.followingReadServiceIds : this.readServiceIds).push(serviceId);
    const failure = this.failWith.get(serviceId);
    if (failure) throw failure;
    const runList = this.runLists.get(serviceId);
    if (!runList) throw new AppError("SERVICE_NOT_FOUND", `Unknown serviceId: ${serviceId}`, 404);
    const following = weekCount === 2 && runList.status === "active" ? (this.followingRuns.get(serviceId) ?? []) : [];
    return structuredClone({ status: runList.status, runs: [...runList.runs, ...following].filter((run) => isUnderWayAt(run, from)) });
  }
}
