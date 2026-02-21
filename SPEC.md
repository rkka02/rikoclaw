# rikoclaw Specification

## Purpose

rikoclaw connects Discord interactions to local CLI coding agents and manages execution, sessions, and scheduling.

## Stack

- Runtime: Node.js + TypeScript
- Discord: `discord.js`
- Session DB: `better-sqlite3`
- Process runners: Claude CLI (`claude`), optional Codex CLI (`codex`)

## Core Components

- `src/index.ts`: Discord bootstrap, command dispatch, message pipeline
- `src/bot.ts`: dependency wiring and runtime context
- `src/core/claude-runner.ts`: Claude CLI adapter
- `src/core/codex-runner.ts`: Codex CLI adapter
- `src/core/queue-manager.ts`: serialized task queue, retries, live status
- `src/core/session-manager.ts`: per-user/context session persistence
- `src/core/persona-manager.ts`: mode bindings and system prompt composition
- `src/core/schedule-manager.ts`: cron parsing/execution for scheduled prompts
- `src/core/heartbeat-manager.ts`: periodic health/status posting
- `src/core/team-manager.ts`: multi-agent team pipeline orchestration
- `src/core/pty-relay-manager.ts`: optional PTY relay server

## Command Surface

User commands:
- `/new`, `/stop`, `/engine`, `/model`, `/verbose`, `/schedule`

Owner commands:
- `/sessions`, `/reload`, `/queue`, `/heartbeat`, `/team`

## Runtime Flow

1. Incoming Discord command/message is validated by access and mention rules.
2. Effective engine/model/session are resolved.
3. Request is enqueued into `QueueManager`.
4. Runner executes CLI process and streams status/tool events.
5. Result is posted to Discord and session metadata is updated.

## Configuration Sources

- `.env` + `src/utils/config.ts`
- Persona files under `./.runtime/personas/`
- Schedules under `./.runtime/personas/schedules.json`

## Non-Goals

- No long-term semantic memory subsystem.
- No dedicated memory management slash command.
