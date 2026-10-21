import { Module } from "@nestjs/common";

// WHY: the push checks of the bus-stops dataset, which npm run data loads from dist/ (scripts/lib/datasets/catalog.js);
// no provider reads them, so the module registers nothing.
@Module({})
export class BusStopsCheckModule {}
