import { SetMetadata } from "@nestjs/common";

export const CACHE_CONTROL_METADATA = "skkuverse:cache-control";

/**
 * Sets `Cache-Control` on a handler's successful responses:
 * `@CacheControl("public, max-age=300")`. ResponseInterceptor writes it when
 * it wraps the handler's value.
 *
 * Not Nest's `@Header()`: that sets the header before the handler runs, so an
 * error response would carry it too, and a shared cache would keep the error.
 * Under CACHE=off the value still becomes `no-store` (no-store.middleware.ts).
 */
export const CacheControl = (value: string): MethodDecorator => SetMetadata(CACHE_CONTROL_METADATA, value);
