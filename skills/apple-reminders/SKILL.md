---
name: apple-reminders
description: Manage Apple Reminders on macOS via AppleScript. Use when the user asks to add, list, complete, delete, or search reminders/tasks. Also handles overdue items. Triggers on keywords like "reminder", "todo", "task", "할 일", "리마인더", "미리 알림", "알림", "해야 할 것".
---

# Apple Reminders

Manage macOS Reminders.app via AppleScript CLI wrapper.

## Quick Reference

```bash
SKILL_DIR="<PROJECT_ROOT>/skills/apple-reminders"

# List all reminder lists with counts
bash "$SKILL_DIR/scripts/reminders.sh" list-all

# List incomplete reminders in a list
bash "$SKILL_DIR/scripts/reminders.sh" list "Reminders"
bash "$SKILL_DIR/scripts/reminders.sh" list "미리 알림"

# Include completed
bash "$SKILL_DIR/scripts/reminders.sh" list "Reminders" true

# Add reminder (no due date)
bash "$SKILL_DIR/scripts/reminders.sh" add "Buy groceries"

# Add with due date and list
bash "$SKILL_DIR/scripts/reminders.sh" add "Meeting prep" "2026-02-20 14:00" "Work"

# Add with priority (1=high, 5=medium, 9=low)
bash "$SKILL_DIR/scripts/reminders.sh" add "Urgent task" "2026-02-20" "Reminders" 1

# Complete a reminder
bash "$SKILL_DIR/scripts/reminders.sh" complete "Buy groceries"

# Delete
bash "$SKILL_DIR/scripts/reminders.sh" delete "Old task"

# Show overdue reminders
bash "$SKILL_DIR/scripts/reminders.sh" overdue

# Search
bash "$SKILL_DIR/scripts/reminders.sh" search "meeting"
```

## Notes

- Default list name is "Reminders" (English). User also has "미리 알림" (Korean) list.
- Priority values: 0 = none, 1 = high (!!!), 5 = medium (!!), 9 = low (!)
- Date format depends on system locale (see apple-calendar skill for format notes)
- `complete` matches by exact name; use `search` first if unsure of exact name
