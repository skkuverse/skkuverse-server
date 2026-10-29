# syntax=docker/dockerfile:1.7

# --- builder stage ---
# devDeps 포함 (tsc + scripts/copy-build-assets.js 필요).
# 이 stage의 산출물은 dist/ 디렉토리뿐 — runtime stage가 그것만 가져감.
FROM node:26-alpine AS builder
WORKDIR /app

# 패키지 매니페스트 + tsconfig만 먼저 복사 → npm ci 결과를 별도 layer로 캐시.
# source 변경 시 npm ci 재실행 없이 build만 다시 돌게 됨.
COPY package.json package-lock.json tsconfig.json ./
# WHY: the devDependency mongodb-memory-server would download a ~100 MB mongod for the tests on
# every rebuild of this layer, and none is published for Alpine; the image never runs the tests.
RUN MONGOMS_DISABLE_POSTINSTALL=1 npm ci

# 나머지 source 복사 후 빌드. .dockerignore가 dist/, node_modules/, __tests__/,
# __fixtures__/, scripts/, docs/ 등을 제외.
COPY . .
# The overlay compiles only at src/private/, where its relative imports resolve (.gitignore keeps it out of git).
# WHY: `perimeter-overlay` is a named build context, which docker-compose.yml always supplies (an empty folder by
# default). No stage of that name stands in, so a plain `docker build` fails here instead of reusing a cached overlay
# under the label `none`; pass --build-context perimeter-overlay=<dir>.
COPY --from=perimeter-overlay . src/private/
RUN npm run build

# --- runtime stage ---
# devDeps 없는 minimal 이미지. tsc/eslint/jest 등 빌드 도구는 ship되지 않음.
FROM node:26-alpine AS runtime
WORKDIR /app

# Production deps만 설치. node_modules 무게 절감 + 공격 표면 감소.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# builder의 dist/ 만 옮김. copy-build-assets.js가 JSON 자산을 dist/에 이미
# 복사해뒀고 __tests__를 strip했으므로 이 한 줄로 runtime 자산 완비.
COPY --from=builder --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000

# The commit this image was built from — Sentry's `release` (src/infra/config.ts).
# Last, so a new commit invalidates no layer above.
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA
# The companion commit of the overlay compiled in, `none` for a build without one (unset or empty).
ARG PERIMETER_OVERLAY_SHA
ENV PERIMETER_OVERLAY_SHA=${PERIMETER_OVERLAY_SHA:-none}
LABEL org.skkuverse.perimeter-overlay=${PERIMETER_OVERLAY_SHA:-none}

# /health/ready: lib/db pingDb() + (role==="api" OR pollers.isReady()).
# 127.0.0.1, not localhost: HOST=0.0.0.0 listens on IPv4 only, and localhost may resolve to ::1.
# docker-compose.yml의 api-1/api-2 healthcheck와 별개로 Dockerfile-level도 유지
# — `docker run` 단독 사용 시도 healthcheck 동작.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health/ready || exit 1

# NestJS entrypoint (cutover 2026-05-30). dist/src/main.js handles the ROLE
# branch (poller/api/combined) itself, same as the legacy dist/index.js did.
# 직접 node로 호출 — npm start의 prestart(`npm run build`) hook은 runtime stage에
# tsc가 없어 실패하므로 우회. (legacy Express entry dist/index.js는 아직 빌드되어
# 남아 있으나 더 이상 실행되지 않음 — 완전 제거는 후속 inline/cleanup 라운드.)
CMD ["node", "dist/src/main.js"]
