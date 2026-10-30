# perimeter-overlay.empty

The default `perimeter-overlay` build context of `docker-compose.yml`, used when `PERIMETER_OVERLAY_DIR` is unset.

Production perimeter implementations are kept outside this repository (ADR 0023). A build passes their folder as the named context `perimeter-overlay`, and the `Dockerfile` copies it to `src/private/` before `npm run build`. A build from this folder copies only this file and compiles no overlay.

Keep this folder free of sources.
