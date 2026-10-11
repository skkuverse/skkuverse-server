import { SetMetadata } from "@nestjs/common";

export const CACHE_CONTROL_METADATA = "skkuverse:cache-control";

// WHY: not Nest's `@Header()`: that sets the header before the handler runs, so an error response
// would carry it too, and a shared cache would keep the error.
export const CacheControl = (value: string): MethodDecorator => SetMetadata(CACHE_CONTROL_METADATA, value);
