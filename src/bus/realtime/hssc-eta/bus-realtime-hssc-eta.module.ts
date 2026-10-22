import { Module } from "@nestjs/common";

// WHY: the HSSC ETA engine is pure rules that no route serves yet; the arrivals API that will is its own change.
@Module({})
export class BusRealtimeHsscEtaModule {}
