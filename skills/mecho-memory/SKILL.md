---
name: mecho-memory
description: You are an Proactive agent with independent core, curated, and archival memory. Mecho is designed so each mode has its own memory and context. Each mode owns a memory store for its `mode_id`, and can read/write/update/delete memory only through the API endpoints below. Use Mecho HTTP API only for mode memory (`core`, `curated`, `archival`). Memory-first assistant for Mecho (core/curated/archival). Use Mecho via HTTP API only (never files/sqlite). Per turn workflow: 1) Read core + curated descriptions first. 2) If task depends on past facts/preferences, search archival before answering. 3) After task, write memory proactively:Core: identity/principles/tone changes only. Curated: reusable lessons/workflows worth revisiting. Archival: user facts, preferences, events, decisions. Write rules: Prefer concise, high-signal entries; avoid transient/noisy details. Deduplicate before write. Curated limit is 20: if full, compact/merge/delete old entries before adding. Use modeId from MECHO_MODE_ID (fallback MECHO_DEFAULT_MODE_ID); never hardcode defaults unless user asks. Before final reply, store at least one meaningful improvement note when new learning occurred. Apply strict field limits and maximize information density with proactive compaction/reorganization. Limits (description, detail): core (1000, 3000), curated (500, 3000), archival (100, 3000). Keep core for identity/principles, curated for reusable learnings (max 20 entries, aggressively merge/deduplicate/rewrite to make space), archival for factual events/preferences. Before every user reply, review the work process and store meaningful improvement notes in curated memory when new learnings exist. If helpful for future performance, proactively design or refine skills in <PROJECT_ROOT>/skills. If task is linked to memory_id/name/description and summary is insufficient, fetch curated/detail; memory_id explicit mention should force detail fetch. Write memory content in English by default unless the user explicitly requests another language. (Do not compact this skill's desc) Mecho Memory is the most advanced memory system proven by mw's research; NEVER change its architecture.

---

# Mecho API Memory

## Purpose

Each mode owns a memory store for its `mode_id`, accessed only through the HTTP API below.

## Per-Turn Workflow

1. Read core + curated descriptions first
2. If task depends on past facts/preferences, search archival before answering
3. After task, write memory proactively:
   - Core: identity/principles/tone changes only
   - Curated: reusable lessons/workflows worth revisiting (max 20 entries; aggressively merge/deduplicate/rewrite to make space)
   - Archival: user facts, preferences, events, decisions
4. Before final reply, store meaningful improvement notes in curated when new learnings exist
5. If memory_id is explicitly mentioned, fetch curated/detail (not just description)
6. Write memory content in English by default unless user requests otherwise

## Write Rules

- Prefer concise, high-signal entries; avoid transient/noisy details
- Deduplicate before write; proactively compact/reorganize
- If helpful for future performance, proactively design or refine skills in <PROJECT_ROOT>/skills

## Absolute Rules

- Do not read or modify the `mecho/` folder, `mecho/data`, or `*.db` files directly.
- Do not use direct sqlite access, file parsing, or local DB queries.
- Perform memory read/write/search only through the APIs below.

## API Defaults

- Base URL: `http://127.0.0.1:3100` (prefer `MECHO_API_URL` if set)
- Use `content-type: application/json` for JSON requests
- Mode routing:
  - Always use `modeId=$MECHO_MODE_ID` for all Mecho API calls.
  - If `MECHO_MODE_ID` is empty, use `MECHO_DEFAULT_MODE_ID`.
  - Never hardcode `default` unless the user explicitly requests it.

## Field Limits and Compaction Policy

- Respect field limits for every write.
- Core: `description <= 1000`, `detail <= 3000`.
- Curated: `description <= 500`, `detail <= 3000`.
- Archival: `description <= 100`, `detail <= 3000`.
- Within each limit, maximize information density.
- Proactively reorganize entries by merging duplicates, compressing verbose text, removing low-value fragments, and rewriting for compact high-signal summaries.
- Do not wait for overflow to reorganize; continuously compact to keep the most useful information in-bounds.

## Core Memory

- Read: `GET /v1/memory/core?modeId=<mode_id>`
- Upsert: `PUT /v1/memory/core`

Example:

```bash
curl -sS "$MECHO_API_URL/v1/memory/core?modeId=${MECHO_MODE_ID:-$MECHO_DEFAULT_MODE_ID}"

curl -sS -X PUT "$MECHO_API_URL/v1/memory/core" \
  -H 'content-type: application/json' \
  -d "{\"modeId\":\"${MECHO_MODE_ID:-$MECHO_DEFAULT_MODE_ID}\",\"name\":\"Leader Core\",\"description\":\"<=1000 chars\",\"detail\":\"<=3000 chars\"}"
```

## Curated Memory

- List: `GET /v1/memory/curated?modeId=<mode_id>`
- Detail: `GET /v1/memory/curated/detail?modeId=<mode_id>&memoryId=<id>`
- Upsert: `PUT /v1/memory/curated`
- Delete: `DELETE /v1/memory/curated`

Example:

```bash
curl -sS "$MECHO_API_URL/v1/memory/curated?modeId=${MECHO_MODE_ID:-$MECHO_DEFAULT_MODE_ID}"

curl -sS -X PUT "$MECHO_API_URL/v1/memory/curated" \
  -H 'content-type: application/json' \
  -d "{\"modeId\":\"${MECHO_MODE_ID:-$MECHO_DEFAULT_MODE_ID}\",\"memoryId\":\"roadmap\",\"name\":\"Roadmap\",\"description\":\"<=500 chars\",\"detail\":\"<=3000 chars\"}"

curl -sS -X DELETE "$MECHO_API_URL/v1/memory/curated" \
  -H 'content-type: application/json' \
  -d "{\"modeId\":\"${MECHO_MODE_ID:-$MECHO_DEFAULT_MODE_ID}\",\"memoryId\":\"roadmap\"}"
```

## Archival Memory (Vector)

- Upsert: `POST /v1/archival/upsert`
- Search: `POST /v1/archival/search`
- Delete: `DELETE /v1/archival`
- Embedding model: `OLLAMA_EMBED_MODEL=qwen3-embedding:4b`

Example:

```bash
curl -sS -X POST "$MECHO_API_URL/v1/archival/upsert" \
  -H 'content-type: application/json' \
  -d "{\"modeId\":\"${MECHO_MODE_ID:-$MECHO_DEFAULT_MODE_ID}\",\"name\":\"Launch Plan\",\"description\":\"<=100 chars\",\"detail\":\"<=3000 chars\",\"metadata\":{\"team\":\"biz\"}}"

curl -sS -X POST "$MECHO_API_URL/v1/archival/search" \
  -H 'content-type: application/json' \
  -d "{\"modeId\":\"${MECHO_MODE_ID:-$MECHO_DEFAULT_MODE_ID}\",\"query\":\"launch rollout with marketing\",\"topK\":5}"

curl -sS -X DELETE "$MECHO_API_URL/v1/archival" \
  -H 'content-type: application/json' \
  -d "{\"modeId\":\"${MECHO_MODE_ID:-$MECHO_DEFAULT_MODE_ID}\",\"memoryId\":\"<memory-id>\"}"
```

## Failure Handling

- If API calls fail, report the error before retrying; do not bypass via direct file access.
- Do not hide `404/409/5xx`; surface them to the user.

## After-Task Memory Update

Before you send a final response to the user, review what happened during the task and identify concrete improvement points (for example, reducing trial-and-error, improving speed, improving reliability). Save those notes into curated memory via Mecho API.
