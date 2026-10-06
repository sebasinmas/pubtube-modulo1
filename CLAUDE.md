# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PubTube Módulo 1 — content management & storage backend (NestJS 12, TypeScript, ESM). Handles resumable video uploads to S3-compatible storage, video metadata in PostgreSQL (Drizzle ORM), and the editorial state machine. Code, comments, logs, commit examples and docs are in **Spanish**; keep new code consistent (e.g. method names like `crearBorrador`, `marcarComoListo`).

## Commands

Package manager is **pnpm**. `pnpm install` also installs Lefthook git hooks.

```bash
cp .env.example .env                                         # dev defaults work as-is
docker compose up -d --wait db garage garage-setup migrate   # infra + migrations (Postgres :5433, S3 :9000)
pnpm run start:dev --env-file .env                           # Nest with watch; Nest does not load .env itself
docker compose up -d --build                                 # alternatively: API + infra all in Docker
```

- Unit tests: `pnpm test` (Vitest, `**/*.spec.ts`, colocated next to sources)
- Single test file: `pnpm exec vitest run src/modules/videos/services/video-state.service.spec.ts` (add `-t "<name>"` to filter by test name)
- Integration tests: `pnpm test:integration` — runs `scripts/test-integration.ts`, which brings up `docker-compose.test.yml` with `.env.test` (Postgres :5434, Garage :9100, tmpfs), runs the `garage-setup-test` one-shot via `compose run` (its exit code aborts the suite), migrates, runs `**/*.e2e-spec.ts` via `vitest.config.e2e.ts`, then tears everything down.
  - To iterate manually, every host-side command must load `.env.test` (otherwise `drizzle.config.ts` and the E2E suite read the dev `.env`): `pnpm exec dotenvx run -f .env.test -- pnpm test:integration:manual`. Full sequence in the README, section 5.
- Full CI-equivalent check: `pnpm run validate` (format:check → oxlint → tsc → madge cycles → type-aware ESLint → unit tests). CI additionally runs `pnpm run build`, and integration tests only for PRs/pushes to `main`.
- Individual checks: `pnpm run lint` (oxlint), `lint:types` (ESLint w/ type info), `typecheck`, `check:cycles`, `format`.
- Schema change: edit `src/db/schema.ts`, then `pnpm run db:generate` to create a migration in `src/db/migrations/` (commit the SQL + `meta/`).

## Conventions enforced by tooling

- **Conventional Commits** are required by the `commit-msg` hook: `type(scope): description`, types `feat|fix|docs|style|refactor|test|chore|ci|perf`, subject ≤100 chars.
- pre-commit: Prettier + oxlint on staged `src/**/*.ts`; pre-push: `tsc --noEmit` + madge cycle detection.
- ESM with `module: nodenext` — relative imports **must use the `.js` extension** (e.g. `'./app.module.js'`).
- Floating promises are an oxlint error, `no-misused-promises`/`require-await` are ESLint errors; explicit `any` is only an oxlint warning (sprint-1 debt). Module dependency cycles are forbidden.
- Unit test conventions (README, section 6): stub env with `vi.stubEnv`, fake `Date` instead of calendar literals, typed mocks (`vi.fn<Svc['method']>()`), and record known unfixed bugs as `it.todo(...)` rather than asserting the buggy behavior.

## Architecture

- `src/app.module.ts` wires everything; there is currently no separate feature module for videos — controller/services/repository are registered directly in `AppModule`.
- **DI tokens (string-based)**: `DATABASE_CONNECTION` (Drizzle `NodePgDatabase`, typed as `DrizzleDb` in `src/db/types.ts`), `MESSAGE_BROKER`, `SESSION_VALIDATOR`, `YOUTUBE_SERVICE`. Inject with `@Inject('<TOKEN>')`; unit tests replace these with `vi.fn()` mocks by constructing classes directly.
- **Object storage — "Minio" naming is legacy**: storage was migrated from MinIO to **Garage** (see `ADR/002-migracion-minio-a-garage.md`), but `MinioService`, `src/infrastructure/minio/`, the `minio_upload_id` column and `MINIO_*` env vars were intentionally kept. `MinioService` uses `@aws-sdk/client-s3` (path-style) and works against any S3 API. Garage's S3 port inside the container is 3900 (mapped to host 9000). One secret-free `garage.toml` serves all environments; `GARAGE_RPC_SECRET`/`GARAGE_ADMIN_TOKEN` come from env. The server itself creates the key + content bucket (`--single-node --default-bucket`); the one-shot `garage-setup` service (`scripts/garage-setup.sh`, image from `scripts/garage-setup.Dockerfile`) adds the thumbnails bucket and permissions. In dev/prod compose, a one-shot `migrate` service (Dockerfile `builder` stage) runs Drizzle migrations before the API starts. Presigned URLs are signed with the API's S3 endpoint, so when the API runs inside Docker they point at `garage:3900` (unreachable from the host). `AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED` is needed for Garage compatibility.
- **Resumable upload flow (US-A1)** in `VideoUploadController` (`/api/content`):
  1. `POST init` validates mime (mp4/mov) and `sizeBytes` (≤ `MAX_UPLOAD_SIZE_BYTES`, default 2GB), starts an S3 multipart upload, inserts a `borrador` video row; the video id doubles as `uploadSessionId`, object key is `<videoId>/<filename>`.
  2. `GET :sessionId/part/:partNumber` returns a presigned `UploadPart` URL — the client uploads chunks directly to storage.
  3. `GET upload/:sessionId/status` lists already-uploaded parts (for resuming).
  4. `POST upload/:sessionId/complete` completes the multipart upload, computes SHA-256 by streaming the object, stores it, and publishes `video.uploaded`.
- **State machine**: `borrador → listo → programado → publicado` (Postgres enum `video_status`). `VideoStateService` performs transitions in transactions with `SELECT ... FOR UPDATE`. `VideoWorkerService` is a `@Cron` (every 5 min) that moves due `programado` videos to `publicado` after `YoutubeService` confirms availability.
- **Messaging**: `MessageBrokerService` is an in-process stub over `@nestjs/event-emitter` (meant to be replaced by RabbitMQ). Every event is wrapped in an `EventEnvelope` (id, type, version, correlationId, causationId, source `module1-content`). Event payload contracts live as JSON Schemas in `docs/contratos/` (`video.uploaded`, `metadata.updated`) — keep them in sync when changing payloads. Correlation IDs come from the `x-correlation-id` header.
- **Auth** is externalized: `SessionValidatorService.validar()` always resolves `true` for now.
- Integration tests (`test/integration/`) boot the real `AppModule` against real Postgres/Garage (no mocks) and listen on `EventEmitter2` to assert published events.

## Repo docs

`ADR/` holds architecture decisions (tech stack, MinIO→Garage). `scrum/` and `ROLES.md` are course/Scrum artifacts, not code.
