// WHY: static config resolved per request, so it may be cached like the mini-app registry it references;
// five minutes also bounds how late a banner's `endAt` takes effect.
export const UI_CACHE_CONTROL = "public, max-age=300";
