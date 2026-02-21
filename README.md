# rikoclaw

rikoclaw is a Discord bot that runs coding agents through CLI backends (`claude`, optional `codex`) with session persistence, queueing, scheduled automation, and optional Mecho memory.

This README reflects the current `main` codebase state.

## Core Capabilities

- Discord-first workflow
  - Slash-command workflow (`/new`, `/stop`, `/model`, `/engine`, etc.)
  - Optional mention-based chat replies (`ENABLE_MENTION_RESPONSE=true`)
- Multi-engine runtime
  - Claude Code CLI as default engine
  - Optional Codex CLI engine per conversation context
- Per-context session persistence
  - Sessions are tracked by user + channel/thread/DM + engine
  - Automatic recovery for stale/invalid resume sessions
- Queue and live progress
  - Configurable queue size and concurrent runs
  - Live status updates in Discord (toggle with `/verbose`)
- Turn-scoped attachment bridge
  - Input files: staged files + Discord attachments
  - Output files: any files written during a turn are sent back to Discord (size-limited)
- Session rotation near context limits
  - Auto-summary and session reset when token usage crosses threshold
  - Summary is injected into the next session automatically
- Automation and operations
  - Cron schedules (`/schedule`) in KST (5-field cron)
  - Heartbeat checks (`/heartbeat`) with active-hour windows
  - Owner ops: `/sessions`, `/queue`, `/reload`, `/team`
- Optional runtime extras
  - Mecho memory integration (`MECHO_ENABLED=true`)
  - PTY relay websocket server for remote terminal attachment
  - macOS `launchctl` self-restart + auto session resume

## Slash Commands

- General
  - `/new prompt:<text> file:<attachment?>`
  - `/stop`
  - `/engine engine:<claude|codex?>`
  - `/model preset:<...?> custom:<...?>`
  - `/verbose set:<on|off|default?>`
- Mode / Mecho
  - `/mode list`
  - `/mode set mode_id:<id>`
  - `/mode current`
  - `/mode reset`
  - `/mode create mode_id:<id>` (owner only)
  - `/mode delete mode_id:<id>` (owner only)
- Scheduling (owner only)
  - `/schedule list`
  - `/schedule add id:<id> cron:<expr> prompt:<text> [mode_id] [channel] [mode] [enabled]`
  - `/schedule toggle id:<id>`
  - `/schedule remove id:<id>`
  - `/schedule run id:<id>`
- Admin / owner
  - `/sessions`
  - `/reload`
  - `/queue`
  - `/heartbeat status|trigger`
  - `/team instruction:<text>`

## Bundled Skills (Current)

`skills/` currently includes:

- `agent-browser`
- `apple-calendar`
- `apple-notes`
- `apple-reminders`
- `automation-mcp`
- `discord-cron-scheduler`
- `frontend-design`
- `gemini-cli`
- `mcp-builder`
- `mecho-memory`
- `media-control`
- `self-restart-resume`
- `skill-creator`
- `trend-monitor`
- `web-design-guidelines`
- `webapp-testing`

These are discovered automatically from `skills/*/SKILL.md` and exposed in system prompts.

## Requirements

- Node.js 18+
- Discord bot application + token
- Claude Code CLI installed and authenticated (`claude`)
- Optional: Codex CLI (`codex`) when `CODEX_ENABLED=true`
- Optional: Mecho service (`./mecho`) for memory APIs

## Quick Start

```bash
git clone <repository-url>
cd rikoclaw
npm install
cp .env.example .env
npm start
```

If you use Mecho memory:

```bash
npm --prefix mecho install
cp mecho/.env.example mecho/.env
npm --prefix mecho run start
```

## Configuration

Set values in `.env`.

Required:

- `DISCORD_TOKEN`
- `OWNER_ID`

Important groups:

- Access control
  - `ALLOWED_USER_IDS`
  - `ALLOWED_CHANNEL_IDS`
- Discord message mode
  - `ENABLE_MENTION_RESPONSE`
  - `REQUIRE_MENTION`
  - `DISCORD_MESSAGE_CONTENT_INTENT`
- Claude runtime
  - `CLAUDE_PATH`, `CLAUDE_MODEL`, `CLAUDE_TIMEOUT`, `CLAUDE_MAX_TURNS`
  - `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS`, `CLAUDE_PERMISSION_MODE`
  - `CLAUDE_ADD_DIRS`
- Codex runtime
  - `CODEX_ENABLED`, `CODEX_PATH`, `CODEX_MODEL`, `CODEX_TIMEOUT`, `CODEX_ENABLE_SEARCH`
- Queue/runtime
  - `MAX_QUEUE_SIZE`, `MAX_CONCURRENT_RUNS`, `ENABLE_LIVE_UPDATES`
- Session rotation
  - `SESSION_ROTATION_ENABLED`, `SESSION_ROTATION_THRESHOLD`, `SESSION_ROTATION_SUMMARY_TIMEOUT`
- Heartbeat
  - `HEARTBEAT_ENABLED`, `HEARTBEAT_CHANNEL_ID`, `HEARTBEAT_INTERVAL_MINUTES`
  - `HEARTBEAT_ACTIVE_HOURS_START`, `HEARTBEAT_ACTIVE_HOURS_END`
- PTY relay
  - `PTY_RELAY_ENABLED`, `PTY_RELAY_PORT`, `PTY_RELAY_TOKEN`
  - `PTY_RELAY_ORPHAN_TIMEOUT`, `PTY_RELAY_MAX_SESSIONS`
- Self restart (macOS)
  - `SELF_RESTART_ENABLED`, `SELF_RESTART_COMMAND`, `SELF_RESTART_DELAY_SEC`
  - `SELF_RESTART_MAX_PENDING_MINUTES`, `SELF_RESTART_LAUNCH_LABEL`
- Mecho integration
  - `MECHO_ENABLED`, `MECHO_API_URL`, `MECHO_TIMEOUT_MS`, `MECHO_DEFAULT_MODE_ID`
  - `OLLAMA_URL`, `OLLAMA_EMBED_MODEL`, `OLLAMA_TIMEOUT_MS`

Storage-related defaults:

- Runtime data: `DATA_DIR` (default `./.runtime`)
- Turn attachment staging: `CLAUDE_INPUT_DIR` (default `./data/input`)
- Turn output handoff: `CLAUDE_OUTPUT_DIR` (default `./data/output`)

## Attachment Bridge and Restart Signal

For each run, rikoclaw creates a temporary turn workspace under `.runtime/turn-work/...`.

- Incoming files (staged local files and Discord attachments) are copied into that turn input folder.
- Files created in turn output are sent back to Discord automatically.
- Turn work folders are removed after completion.
- To request runtime restart from an agent response, write JSON to:
  - `.rikoclaw-restart.json` in the turn output folder

Example:

```json
{"reason":"brief reason","resumePrompt":"what to continue after restart","delaySec":3}
```

## Mecho Service (Optional)

`mecho/` is a separate Express service exposing memory and mode APIs.

Key endpoints:

- `GET /health`
- `POST /v1/turn/prepare`
- `POST /v1/turn/ack`
- `GET|PUT /v1/memory/core`
- `GET|PUT|DELETE /v1/memory/curated`
- `POST /v1/archival/search`
- `POST /v1/archival/upsert`
- `DELETE /v1/archival`
- `GET /v1/mode/list`
- `POST /v1/mode/create`
- `POST /v1/mode/delete`

## MCP Configuration

- `.mcp.json` is intentionally empty in this public repo.
- Use `.mcp.example.json` as a local template for your MCP servers.
- Do not commit machine-specific secret paths/tokens.

## Project Layout

- `src/index.ts`: app entrypoint and Discord event handling
- `src/commands/*`: slash command handlers
- `src/core/*`: queue, session, schedule, heartbeat, team, restart, PTY relay, managers
- `src/integrations/mecho-client.ts`: Mecho API client
- `src/utils/*`: config/access/format utilities
- `skills/*`: skill definitions loaded into prompts
- `mecho/src/*`: optional memory service
- `test/*.test.js`: runtime unit tests

## Public Build Exclusions

The following were intentionally removed before open sourcing:

- Stock/trading MCP skills and related assets:
  - `skills/kis-trading`
  - `skills/stock-finance`
  - `skills/market-research`
- Local runtime files/logs/databases (for example `.runtime/*`, `data/*`, `mecho/data/*`)
- Private/local configuration (for example `.env`, `.claude/*`)

## Test

```bash
npm test
```

## Security Checklist Before Publish

- Keep `.env` out of git.
- Keep all DB files and logs out of git.
- Confirm there are no private tokens/keys in tracked files.
- Review `.mcp.json` before pushing.

## License

MIT
