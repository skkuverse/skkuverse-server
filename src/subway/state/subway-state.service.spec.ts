/**
 * SubwayStateService over FakeSubwayRepository, handed each tick's arrivals documents as the tracker hands them
 * (add-commute-station-subway design D10). What it guards, by the subway-arrivals spec's scenarios: a quiet tick
 * rewrites no platform whose trains are unchanged since its last write ("Quiet tick"), a platform unchanged for
 * 60 s is rewritten with the tick's `generatedAt` ("Freshness kept"), only the platforms that changed are
 * written, a new process writes every platform on its first tick, and a failed write is remembered as unwritten,
 * so the next tick writes it again. The documents are hand-written in the shape the tracker writes.
 */
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { FakeSubwayRepository } from "../../../__tests__/helpers/fakes/subway/subway.repository.fake";
import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";
import type { SubwayRepository } from "../subway.repository";
import { SubwayStateService } from "./subway-state.service";

const JEONGJA_SHINBUNDANG = "DX-D1-4312";
const JEONGJA_SUIN_BUNDANG = "KR-K1-K230";
const at = (kst: string): Date => new Date(`2026-10-19T${kst}+09:00`);

const shinbundang: StoredTrainArrival = {
  trainNo: "1031",
  destination: "광교",
  express: false,
  arrivalAt: at("21:04:10"),
  source: "estimated",
  position: { stationId: "DX-D1-4311", state: "arrived" },
};
const suinBundang: StoredTrainArrival = { ...shinbundang, trainNo: "6180", destination: "왕십리", arrivalAt: at("21:06:00"), source: "scheduled", position: null };

function doc(platformId: string, generatedKst: string, down: readonly StoredTrainArrival[]): SubwayArrivalsDoc {
  return { _id: platformId, generatedAt: at(generatedKst), serviceDate: "2026-10-19", directions: { up: [], down } };
}

const tick = (generatedKst: string, shinbundangDown = [shinbundang]): SubwayArrivalsDoc[] => [
  doc(JEONGJA_SHINBUNDANG, generatedKst, shinbundangDown),
  doc(JEONGJA_SUIN_BUNDANG, generatedKst, [suinBundang]),
];

function setup(repository = new FakeSubwayRepository()) {
  return { repository, service: new SubwayStateService(asReal<SubwayRepository>(repository)) };
}

const generatedAtOf = (repository: FakeSubwayRepository, platformId: string): Date | undefined => repository.docs.get(platformId)?.generatedAt;

describe("SubwayStateService.writeArrivals", () => {
  it("Quiet tick: a train-map tick that changes no 정자 train, 20 s after the last write, rewrites neither platform", async () => {
    // Arrange
    const { repository, service } = setup();
    await service.writeArrivals(tick("21:03:10"));

    // Act
    await service.writeArrivals(tick("21:03:30"));

    // Assert
    expect([generatedAtOf(repository, JEONGJA_SHINBUNDANG), generatedAtOf(repository, JEONGJA_SUIN_BUNDANG)]).toEqual([at("21:03:10"), at("21:03:10")]);
    expect(repository.replaces).toBe(1);
  });

  it("Freshness kept: trains unchanged for 60 s are rewritten with the tick's generatedAt", async () => {
    // Arrange
    const { repository, service } = setup();
    await service.writeArrivals(tick("21:03:10"));
    await service.writeArrivals(tick("21:03:30"));

    // Act
    await service.writeArrivals(tick("21:04:10"));

    // Assert
    expect([generatedAtOf(repository, JEONGJA_SHINBUNDANG), generatedAtOf(repository, JEONGJA_SUIN_BUNDANG)]).toEqual([at("21:04:10"), at("21:04:10")]);
  });

  it("counts the 60 s from the last write, not from the last tick", async () => {
    // Arrange
    const { repository, service } = setup();
    await service.writeArrivals(tick("21:03:10"));
    await service.writeArrivals(tick("21:03:40"));

    // Act
    await service.writeArrivals(tick("21:04:09"));

    // Assert
    expect(generatedAtOf(repository, JEONGJA_SHINBUNDANG)).toEqual(at("21:03:10"));
  });

  it("writes only the platform whose trains changed", async () => {
    // Arrange
    const { repository, service } = setup();
    await service.writeArrivals(tick("21:03:10"));

    // Act
    await service.writeArrivals(tick("21:03:30", [{ ...shinbundang, arrivalAt: at("21:04:20") }]));

    // Assert
    expect(repository.docs.get(JEONGJA_SHINBUNDANG)?.directions.down[0]?.arrivalAt).toEqual(at("21:04:20"));
    expect([generatedAtOf(repository, JEONGJA_SHINBUNDANG), generatedAtOf(repository, JEONGJA_SUIN_BUNDANG)]).toEqual([at("21:03:30"), at("21:03:10")]);
  });

  it("writes every platform on a restarted process's first tick, though the stored trains are the same", async () => {
    // Arrange
    const { repository, service } = setup();
    await service.writeArrivals(tick("21:03:10"));
    const restarted = setup(repository).service;

    // Act
    await restarted.writeArrivals(tick("21:03:20"));

    // Assert
    expect([generatedAtOf(repository, JEONGJA_SHINBUNDANG), generatedAtOf(repository, JEONGJA_SUIN_BUNDANG)]).toEqual([at("21:03:20"), at("21:03:20")]);
  });

  it("rejects with a failed write and writes those platforms again on the next tick", async () => {
    // Arrange
    const { repository, service } = setup();
    await service.writeArrivals(tick("21:03:10"));
    const failure = new Error("connection reset");
    repository.writeFailWith = failure;
    await expect(service.writeArrivals(tick("21:03:20", []))).rejects.toBe(failure);
    repository.writeFailWith = null;

    // Act
    await service.writeArrivals(tick("21:03:30", []));

    // Assert
    expect(repository.docs.get(JEONGJA_SHINBUNDANG)?.directions.down).toEqual([]);
    expect(generatedAtOf(repository, JEONGJA_SHINBUNDANG)).toEqual(at("21:03:30"));
  });
});
