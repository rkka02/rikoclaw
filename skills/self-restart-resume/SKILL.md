---
name: self-restart-resume
description: Request self-restart of the ZeroTwo Claw bot process with automatic session resume. Use when runtime code or configuration changes require a process restart, when the user asks to restart/reboot the bot without losing session continuity, or after deploying new skills/hooks. Triggers on keywords like "restart", "reboot", "재시작", "리스타트".
---

# Self Restart Resume

## Required Action
Write `.zerotwo_claw-restart.json` into the turn output directory (the same folder used for agent->user attachments).

## JSON Schema
```json
{
  "reason": "short reason for restart",
  "resumePrompt": "what to continue after restart",
  "delaySec": 3
}
```

## Notes
- `reason`: optional but recommended.
- `resumePrompt`: optional; if omitted, default resume prompt is used.
- `delaySec`: optional positive integer (seconds).
- Keep this file machine-readable JSON only (no comments, no markdown).
