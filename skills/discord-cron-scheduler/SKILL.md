---
name: discord-cron-scheduler
description: Configure recurring scheduled messages for Discord channels using cron expressions in KST timezone. Use when the user asks to set up, edit, enable/disable, remove, list, or manually run scheduled/timed/recurring messages or prompts in Discord. Supports per-schedule mode binding. Triggers on keywords like "cron", "schedule", "timer", "recurring", "periodic", "스케줄", "예약", "반복", "크론".
---

# Discord Cron Scheduler

## Required Inputs
- `id`: unique schedule id.
- `cron`: 5-field cron (`minute hour dayOfMonth month dayOfWeek`).
- `channelId`: target Discord channel id.
- `prompt`: text executed by the scheduler.
- Optional: `modeId`, `modeName`, `enabled`, `model`.
- `modeId` format: lowercase letters, numbers, `_`, `-` (same normalization rule as mecho mode binding).
- `model`: optional per-schedule model override (e.g. `"claude-opus-4-6"`). Omit to use env default.

## Timezone Rule
- Cron matching is fixed to KST (`Asia/Seoul`).
- Do not reinterpret cron with server local timezone.

## Record Schema
```json
{
  "id": "daily-standup",
  "cron": "0 9 * * 1-5",
  "channelId": "123456789012345678",
  "prompt": "Post today's standup checklist.",
  "modeId": "research-mode",
  "modeName": "default",
  "model": "claude-opus-4-6",
  "enabled": true
}
```

## Workflow
1. Load `schedules.json` and parse as array (JSONC comments allowed).
2. Validate required fields and cron expression.
3. Keep `modeId` when provided; otherwise use context-bound default mode at runtime.
4. Write pretty JSON with trailing newline.
5. Confirm key fields in response: `id/key`, `cron`, `KST`, `modeId`, `channelId`, `model`, `enabled`.

## Safety
- Never remove unrelated entries.
- If id is ambiguous, return candidate keys and ask for a specific key.
- Keep diffs minimal.
