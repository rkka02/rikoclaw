#!/bin/bash
# Apple Notes CLI wrapper via AppleScript
# Usage: notes.sh <command> [args...]

CMD="$1"
shift

case "$CMD" in
  list-folders)
    osascript -e 'tell application "Notes" to get name of every folder of account "iCloud"'
    ;;

  list)
    # Usage: notes.sh list [folder] [limit]
    FOLDER="${1:-Notes}"
    LIMIT="${2:-20}"
    osascript <<EOF
      tell application "Notes"
        set output to ""
        set noteList to every note of folder "$FOLDER" of account "iCloud"
        set i to 0
        repeat with n in noteList
          if i >= $LIMIT then exit repeat
          set noteId to id of n
          set noteName to name of n
          set modDate to modification date of n
          set dateStr to short date string of modDate
          set output to output & dateStr & " | " & noteName & " | id:" & noteId & linefeed
          set i to i + 1
        end repeat
        return output
      end tell
EOF
    ;;

  read)
    # Usage: notes.sh read "Note Title" [folder]
    TITLE="$1"
    FOLDER="${2:-Notes}"
    osascript <<EOF
      tell application "Notes"
        set noteList to every note of folder "$FOLDER" of account "iCloud" whose name is "$TITLE"
        if length of noteList > 0 then
          set n to item 1 of noteList
          return plaintext of n
        else
          return "Note not found: $TITLE"
        end if
      end tell
EOF
    ;;

  search)
    # Usage: notes.sh search "keyword"
    KEYWORD="$1"
    osascript <<EOF
      tell application "Notes"
        set output to ""
        set noteList to every note of account "iCloud" whose name contains "$KEYWORD"
        repeat with n in noteList
          set noteName to name of n
          set folderName to name of container of n
          set modDate to modification date of n
          set dateStr to short date string of modDate
          set output to output & dateStr & " | " & noteName & " [" & folderName & "]" & linefeed
        end repeat
        return output
      end tell
EOF
    ;;

  create)
    # Usage: notes.sh create "Title" "Body text" [folder]
    TITLE="$1"
    BODY="$2"
    FOLDER="${3:-Notes}"
    osascript <<EOF
      tell application "Notes"
        tell folder "$FOLDER" of account "iCloud"
          set newNote to make new note with properties {name:"$TITLE", body:"<div><h1>$TITLE</h1><br>$BODY</div>"}
          return "Created: " & name of newNote
        end tell
      end tell
EOF
    ;;

  append)
    # Usage: notes.sh append "Note Title" "Text to append" [folder]
    TITLE="$1"
    TEXT="$2"
    FOLDER="${3:-Notes}"
    osascript <<EOF
      tell application "Notes"
        set noteList to every note of folder "$FOLDER" of account "iCloud" whose name is "$TITLE"
        if length of noteList > 0 then
          set n to item 1 of noteList
          set currentBody to body of n
          set body of n to currentBody & "<br>" & "$TEXT"
          return "Appended to: $TITLE"
        else
          return "Note not found: $TITLE"
        end if
      end tell
EOF
    ;;

  delete)
    # Usage: notes.sh delete "Note Title" [folder]
    TITLE="$1"
    FOLDER="${2:-Notes}"
    osascript <<EOF
      tell application "Notes"
        set noteList to every note of folder "$FOLDER" of account "iCloud" whose name is "$TITLE"
        if length of noteList > 0 then
          delete item 1 of noteList
          return "Deleted: $TITLE"
        else
          return "Note not found: $TITLE"
        end if
      end tell
EOF
    ;;

  *)
    echo "Apple Notes CLI"
    echo ""
    echo "Commands:"
    echo "  list-folders              List all folders"
    echo "  list [folder] [limit]     List notes (default: Notes, 20)"
    echo "  read \"title\" [folder]     Read note content"
    echo "  search \"keyword\"          Search notes by title"
    echo "  create \"title\" \"body\" [folder]  Create new note"
    echo "  append \"title\" \"text\" [folder]  Append to existing note"
    echo "  delete \"title\" [folder]   Delete note"
    ;;
esac
