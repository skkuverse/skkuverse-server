import type { StopPanorama } from "../types";

/**
 * The link a "거리뷰로 보기" button opens: NAVER Map's own app link for a
 * street view panorama, as map.naver.com builds it.
 *
 * Unofficial — the `nmap://` scheme has no panorama action — so it is built
 * here rather than in the app: if NAVER changes the format, one deploy fixes
 * every installed app, where a client-built link would wait for an OTA and
 * stay broken on builds that never take it.
 *
 * Each value appears three times because three readers take different
 * parameter names: the NAVER Map app (`vrpano*`), the redirect page
 * (`id`/`pan`/`tilt`/`fov`), and the web viewer it falls back to without the
 * app (`heading` inside `fallbackUrl`). The output for one panorama was
 * opened on a phone on 2026-10-08 and showed the intended view in the app.
 */
export function buildStreetViewUrl({ panoId, pan, tilt, fov }: StopPanorama): string {
  const fallback = `https://viewer.map.naver.com/panorama/?id=${panoId}&heading=${pan}&tilt=${tilt}&fov=${fov}`;
  return (
    "https://inapp.map.naver.com/launchApp/panorama/street" +
    `?street=on&vrpanoid=${panoId}&vrpanopan=${pan}&vrpanotilt=${tilt}&vrpanofov=${fov}` +
    "&appTargetPage=panorama%2Fstreet" +
    `&id=${panoId}&pan=${pan}&tilt=${tilt}&fov=${fov}` +
    `&fallbackUrl=${encodeURIComponent(fallback)}` +
    "&app=Y&appmarket=N"
  );
}
