---
name: apple-calendar
description: Manage Apple Calendar events on macOS via AppleScript. Use when the user asks to check schedules, view today's events, add/delete calendar events, search for events, or manage their calendar. Triggers on keywords like "calendar", "schedule", "event", "meeting", "appointment", "일정", "약속", "미팅", "캘린더".
---

# Apple Calendar

Manage macOS Calendar.app events via AppleScript CLI wrapper.

## Prerequisites

Calendar.app must have automation permissions for the calling terminal app:
- System Settings > Privacy & Security > Automation > Terminal (or iTerm2) > Calendar.app must be enabled
- If permission is denied (error -600 or -1743), guide the user to enable it

## Quick Reference

```bash
# List calendars
bash scripts/calendar.sh list-calendars

# Today's events
bash scripts/calendar.sh today

# Upcoming 7 days
bash scripts/calendar.sh upcoming 7

# Add event (date format matches system locale - Korean macOS uses "2026년 2월 20일 오후 2:00" style)
bash scripts/calendar.sh add "Meeting" "2026-02-20 14:00" "2026-02-20 15:00" "Calendar"

# Add all-day event
bash scripts/calendar.sh add-allday "Holiday" "2026-02-20" "Calendar"

# Search
bash scripts/calendar.sh search "meeting"

# Delete
bash scripts/calendar.sh delete "Meeting" "2026-02-20"
```

All script paths are relative to this skill's directory: `<PROJECT_ROOT>/skills/apple-calendar/`

## Date Format Notes

AppleScript date parsing depends on macOS system locale. For Korean locale:
- Try ISO-style first: `"2026-02-20 14:00"`
- If that fails, use Korean format: `"2026년 2월 20일 오후 2:00"`
- Test with `osascript -e 'date "2026-02-20 14:00"'` to verify

## Direct AppleScript (for complex queries)

For operations not covered by the script, use `osascript` directly:

```bash
# Get event details
osascript -e 'tell application "Calendar" to get {summary, start date, end date} of every event of calendar "Calendar" whose start date > (current date)'

# Modify event
osascript -e 'tell application "Calendar" to set summary of event 1 of calendar "Calendar" to "New Title"'
```
