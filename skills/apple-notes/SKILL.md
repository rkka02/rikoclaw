---
name: apple-notes
description: Manage Apple Notes on macOS via AppleScript. Use when the user asks to create, read, search, list, append to, or delete notes in Apple Notes.app. Triggers on keywords like "notes", "note", "memo", "메모", "노트", "Apple Notes", "iCloud notes".
---

# Apple Notes

Manage macOS Notes.app via AppleScript CLI wrapper. Accesses iCloud-synced notes.

## Quick Reference

```bash
SKILL_DIR="<PROJECT_ROOT>/skills/apple-notes"

# List folders
bash "$SKILL_DIR/scripts/notes.sh" list-folders

# List recent notes (default: Notes folder, 20 items)
bash "$SKILL_DIR/scripts/notes.sh" list
bash "$SKILL_DIR/scripts/notes.sh" list "Notes" 10

# Read a note
bash "$SKILL_DIR/scripts/notes.sh" read "My Note Title"

# Search by title
bash "$SKILL_DIR/scripts/notes.sh" search "keyword"

# Create a note
bash "$SKILL_DIR/scripts/notes.sh" create "Title" "Body content here"
bash "$SKILL_DIR/scripts/notes.sh" create "Title" "Body" "Work"

# Append text to existing note
bash "$SKILL_DIR/scripts/notes.sh" append "Title" "Additional text"

# Delete a note
bash "$SKILL_DIR/scripts/notes.sh" delete "Title"
```

## Notes

- All operations default to the "Notes" folder in "iCloud" account
- Note body supports basic HTML: `<br>` for line breaks, `<b>`, `<i>`, `<ul>/<li>` etc.
- Search is by title only; for full-text search, list notes and read individually
- `list` output includes note IDs for advanced operations

## Direct AppleScript

For operations beyond the script:

```bash
# Full-text search (slow for many notes)
osascript -e 'tell application "Notes" to get name of every note of account "iCloud" whose plaintext contains "keyword"'

# Get note count
osascript -e 'tell application "Notes" to count of notes of folder "Notes" of account "iCloud"'
```
