# Build `mecho/` SQL+XML Memory Backbone and Wire Delta Injection into rikoclaw

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is maintained in accordance with `PLANS.md` at repository root.

## Purpose / Big Picture

After this change, each mode can have isolated memory state (core + curated) stored in its own SQLite database under `mecho/data/modes/<mode_id>/mecho.db`, and rikoclaw will inject memory into prompts using an XML payload only when needed. First turn for a session sends full memory context; subsequent turns send only a delta when memory changed. Modes will be able to read/write/update memory only through API calls to the `mecho` service, not by direct file/database access from rikoclaw.

Observable behavior: running rikoclaw with mecho enabled should call `POST /v1/turn/prepare` before runner execution, prepend XML to prompt when mode is `full` or `delta`, and call `POST /v1/turn/ack` afterward. Repeated turns with unchanged memory should produce `mode=none` and no XML injection.

## Progress

- [x] (2026-02-11 11:42Z) Read `PLANS.md` and confirmed mandatory ExecPlan sections.
- [x] (2026-02-11 11:42Z) Inspected `src/core/queue-manager.ts` and `src/utils/config.ts` to locate minimal integration points.
- [x] (2026-02-11 12:05Z) Implemented `mecho/` project scaffold and HTTP server.
- [x] (2026-02-11 12:08Z) Implemented mecho SQLite schema and repositories (core/curated/revision/events/session sync/prepare log).
- [x] (2026-02-11 12:12Z) Implemented `prepare`/`ack` APIs with XML full/delta rendering.
- [x] (2026-02-11 12:15Z) Implemented memory CRUD APIs for core/curated (API-only access path).
- [x] (2026-02-11 12:21Z) Added thin rikoclaw mecho API client and queue injection/ack hook.
- [x] (2026-02-11 12:28Z) Added env/config wiring and README updates.
- [x] (2026-02-11 12:35Z) Validated with typecheck/tests and manual prepare→ack scenario.

## Surprises & Discoveries

- Observation: Current rikoclaw no longer passes any system prompt into runners, so memory injection can be added cleanly by prepending text to `prompt` in one place.
  Evidence: `src/core/queue-manager.ts` currently calls `runner.run({ prompt, sessionId, model, onEvent })`.

## Decision Log

- Decision: Create `mecho/` as a separate Node/TypeScript service and keep rikoclaw integration to one thin client plus queue hook.
  Rationale: User requested modularization and minimal contact surface with existing repo.
  Date/Author: 2026-02-11 / Codex

- Decision: Use per-mode DB files with identical schema (`data/modes/<mode_id>/mecho.db`) instead of one shared DB.
  Rationale: Strong isolation while keeping backbone logic common.
  Date/Author: 2026-02-11 / Codex

## Outcomes & Retrospective

Implemented service and integration end-to-end. The remaining gap is archival vector memory implementation (`/v1/archival/*`), which is intentionally stubbed with `501 not_implemented` for this phase.

## Context and Orientation

rikoclaw currently enqueues prompts in `src/core/queue-manager.ts` and then calls runner adapters (`ClaudeRunner`/`CodexRunner`) with a plain prompt string. There is no memory-injection logic now. Configuration is loaded through `src/utils/config.ts` and passed into the queue manager through `createContext` in `src/bot.ts`.

In this repository, the term "delta injection" means: for a given session key, send a full XML memory context only once, then only send changes since the last acknowledged revision. A "revision" is a monotonically increasing integer per mode memory store, incremented on each core/curated write or delete. A "session key" is a stable identifier used to track what revision has already been injected to that conversation.

`mecho/` is a companion service inside this repository. It owns the memory database, delta logic, and API surface.

## Plan of Work

First, create the `mecho/` project scaffold with a small HTTP API server and SQLite persistence using `better-sqlite3`. Add a migration that defines the memory schema, revision/event tracking, and per-session sync state. Implement memory CRUD endpoints for core and curated entities with field validation by character limits.

Next, implement `POST /v1/turn/prepare` and `POST /v1/turn/ack`. `prepare` determines whether to return `full`, `delta`, or `none`, renders XML, and records a `prepare_id` row. `ack` marks the prepared turn as acknowledged and advances session sync revision only on success.

Then, add a thin rikoclaw integration client under `src/integrations/mecho-client.ts`. Modify `QueueManager.runTask` to call prepare before each runner invocation, prepend returned XML to the prompt, run the model, then call ack with success/failure. Keep fallback behavior safe: if mecho API fails, continue normal runner execution with original prompt.

Finally, add config toggles (`MECHO_ENABLED`, `MECHO_API_URL`, `MECHO_TIMEOUT_MS`, `MECHO_DEFAULT_MODE_ID`), update `.env.example`, and validate end-to-end with tests/typecheck and a manual API simulation.

## Concrete Steps

All commands below are run from `<PROJECT_ROOT>` unless stated otherwise.

1. Scaffold mecho service under `mecho/`, initialize package, and add source files.
2. Implement migration and repository code for:
   - core memory
   - curated memory
   - revision
   - memory event log
   - session sync
   - prepare turn log
3. Implement API routes:
   - `POST /v1/turn/prepare`
   - `POST /v1/turn/ack`
   - `GET/PUT /v1/memory/core`
   - `GET/PUT/DELETE /v1/memory/curated`
4. Implement XML renderers:
   - full: `<memory_context>`
   - delta: `<memory_delta>`
5. Add rikoclaw client + queue integration with graceful fallback.
6. Add config/env wiring and docs.
7. Run:
   - `npx tsc --noEmit`
   - `npm test`
   - manual curl prepare/ack scenario against mecho.

Expected transcript snippets (to be updated with real output during implementation):

    POST /v1/turn/prepare -> { "mode": "full", "prepareId": "...", "xml": "<memory_context ...>" }
    POST /v1/turn/ack -> { "ok": true }
    Next prepare without changes -> { "mode": "none", "xml": "" }

## Validation and Acceptance

Acceptance criteria are behavior-driven:

- With mecho enabled and memory present, the first run for a session prepends `<memory_context ...>` XML.
- After successful ack, a repeated run with no memory changes returns `mode=none` and injects no XML.
- After changing curated/core through API, next run returns `<memory_delta ...>` with only changed blocks.
- rikoclaw continues processing prompts when mecho is unavailable (logs warning, no crash, no queue deadlock).

Verification commands:

- `npx tsc --noEmit`
- `npm test`
- manual API calls against `mecho` service and log inspection in rikoclaw.

## Idempotence and Recovery

Migration creation is idempotent (`CREATE TABLE IF NOT EXISTS`). Re-running mecho server startup should not corrupt data. If a `prepare` call succeeds but model run fails, `ack(status=failed)` keeps `last_acked_rev` unchanged so the same delta can be retried later. If mecho API is down, rikoclaw executes without injection as a safe fallback.

## Artifacts and Notes

Implementation artifacts to include after coding:

- Mecho schema SQL at `mecho/src/persistence/migrations/001_init.sql`.
- rikoclaw integration file `src/integrations/mecho-client.ts`.
- Queue hook changes in `src/core/queue-manager.ts`.
- Sample prepare/ack JSON responses from local run.

## Interfaces and Dependencies

`mecho/` dependencies:

- `better-sqlite3` for local SQLite access.
- `express` (or equivalent HTTP framework) for API routing.
- `zod` for request validation.

Required API interfaces:

- `POST /v1/turn/prepare`
  Request:
    - `modeId: string`
    - `sessionKey: string`
    - `engine: "claude" | "codex"`
  Response:
    - `prepareId: string`
    - `mode: "full" | "delta" | "none"`
    - `fromRevision: number`
    - `toRevision: number`
    - `xml: string`

- `POST /v1/turn/ack`
  Request:
    - `modeId: string`
    - `prepareId: string`
    - `sessionKey: string`
    - `status: "success" | "failed"`
  Response:
    - `ok: boolean`

- `GET/PUT /v1/memory/core`
- `GET/PUT/DELETE /v1/memory/curated`

rikoclaw internal interfaces to add:

- `MechoClient.prepareTurn(input): Promise<PrepareTurnResult | null>`
- `MechoClient.ackTurn(input): Promise<void>`
- Queue helper that computes stable session key from `{modeId, engine, userId, contextId}`.

---

Change Note (2026-02-11): Created initial ExecPlan for mecho backbone implementation after explicitly ignoring `.plan` per user instruction. This note exists to make the plan revision history explicit.

Change Note (2026-02-11): Updated all paths from `~/mecho` to repository-local `mecho/`, marked completed milestones, and recorded validation outcomes after implementation.
