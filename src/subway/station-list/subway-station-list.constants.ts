// WHY: private: the titles and line names follow Accept-Language, which a shared cache does not key on;
// the body changes only with a deploy or a `subway-station-coords` push.
export const STATION_LIST_CACHE_CONTROL = "private, max-age=300";
