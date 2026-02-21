#!/bin/bash
# Apple Reminders CLI wrapper via AppleScript
# Usage: reminders.sh <command> [args...]

CMD="$1"
shift

case "$CMD" in
  list-all)
    osascript <<'EOF'
      tell application "Reminders"
        set output to ""
        repeat with l in every list
          set listName to name of l
          set total to count of reminders of l
          set incomplete to count of (reminders of l whose completed is false)
          set output to output & listName & " (" & incomplete & "/" & total & ")" & linefeed
        end repeat
        return output
      end tell
EOF
    ;;

  list)
    # Usage: reminders.sh list [list-name] [show-completed:true/false]
    LIST_NAME="${1:-Reminders}"
    SHOW_COMPLETED="${2:-false}"
    if [ "$SHOW_COMPLETED" = "true" ]; then
      osascript -e "
        tell application \"Reminders\"
          set output to \"\"
          set rems to every reminder of list \"$LIST_NAME\"
          repeat with r in rems
            set remName to name of r
            set remDue to \"\"
            try
              set remDue to short date string of (due date of r) & \" \" & time string of (due date of r)
            end try
            set pri to priority of r
            set priStr to \"\"
            if pri is 1 then set priStr to \" [!!!]\"
            if pri is 5 then set priStr to \" [!!]\"
            if pri is 9 then set priStr to \" [!]\"
            if remDue is not \"\" then
              set output to output & remDue & \" | \" & remName & priStr & linefeed
            else
              set output to output & \"(no date) | \" & remName & priStr & linefeed
            end if
          end repeat
          return output
        end tell"
    else
      osascript -e "
        tell application \"Reminders\"
          set output to \"\"
          set rems to every reminder of list \"$LIST_NAME\" whose completed is false
          repeat with r in rems
            set remName to name of r
            set remDue to \"\"
            try
              set remDue to short date string of (due date of r) & \" \" & time string of (due date of r)
            end try
            set pri to priority of r
            set priStr to \"\"
            if pri is 1 then set priStr to \" [!!!]\"
            if pri is 5 then set priStr to \" [!!]\"
            if pri is 9 then set priStr to \" [!]\"
            if remDue is not \"\" then
              set output to output & remDue & \" | \" & remName & priStr & linefeed
            else
              set output to output & \"(no date) | \" & remName & priStr & linefeed
            end if
          end repeat
          return output
        end tell"
    fi
    ;;

  add)
    # Usage: reminders.sh add "Reminder text" ["due date"] ["list name"] [priority:0-9]
    NAME="$1"
    DUE="$2"
    LIST_NAME="${3:-Reminders}"
    PRIORITY="${4:-0}"
    if [ -n "$DUE" ]; then
      osascript <<EOF
        tell application "Reminders"
          tell list "$LIST_NAME"
            set newRem to make new reminder with properties {name:"$NAME", due date:date "$DUE", priority:$PRIORITY}
            return "Created: " & name of newRem
          end tell
        end tell
EOF
    else
      osascript <<EOF
        tell application "Reminders"
          tell list "$LIST_NAME"
            set newRem to make new reminder with properties {name:"$NAME", priority:$PRIORITY}
            return "Created: " & name of newRem
          end tell
        end tell
EOF
    fi
    ;;

  complete)
    # Usage: reminders.sh complete "Reminder text" ["list name"]
    NAME="$1"
    LIST_NAME="${2:-Reminders}"
    osascript <<EOF
      tell application "Reminders"
        set rems to every reminder of list "$LIST_NAME" whose name is "$NAME" and completed is false
        if length of rems > 0 then
          set completed of item 1 of rems to true
          return "Completed: $NAME"
        else
          return "Not found: $NAME"
        end if
      end tell
EOF
    ;;

  delete)
    # Usage: reminders.sh delete "Reminder text" ["list name"]
    NAME="$1"
    LIST_NAME="${2:-Reminders}"
    osascript <<EOF
      tell application "Reminders"
        set rems to every reminder of list "$LIST_NAME" whose name is "$NAME"
        if length of rems > 0 then
          delete item 1 of rems
          return "Deleted: $NAME"
        else
          return "Not found: $NAME"
        end if
      end tell
EOF
    ;;

  overdue)
    osascript <<'EOF'
      tell application "Reminders"
        set output to ""
        set now to current date
        repeat with l in every list
          set rems to every reminder of l whose completed is false and due date < now
          repeat with r in rems
            set remName to name of r
            set remDue to short date string of (due date of r)
            set listName to name of l
            set output to output & remDue & " | " & remName & " [" & listName & "]" & linefeed
          end repeat
        end repeat
        return output
      end tell
EOF
    ;;

  search)
    # Usage: reminders.sh search "keyword"
    KEYWORD="$1"
    osascript <<EOF
      tell application "Reminders"
        set output to ""
        repeat with l in every list
          set rems to every reminder of l whose name contains "$KEYWORD" and completed is false
          repeat with r in rems
            set remName to name of r
            set listName to name of l
            set output to output & remName & " [" & listName & "]" & linefeed
          end repeat
        end repeat
        return output
      end tell
EOF
    ;;

  *)
    echo "Apple Reminders CLI"
    echo ""
    echo "Commands:"
    echo "  list-all                     List all reminder lists with counts"
    echo "  list [list] [completed]      List reminders (default: Reminders, incomplete only)"
    echo "  add \"text\" [\"due\"] [list] [priority]  Add reminder (priority: 0=none,1=high,5=med,9=low)"
    echo "  complete \"text\" [list]       Mark reminder as complete"
    echo "  delete \"text\" [list]         Delete reminder"
    echo "  overdue                      Show overdue reminders"
    echo "  search \"keyword\"             Search incomplete reminders"
    ;;
esac
