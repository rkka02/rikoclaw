#!/bin/bash
# Apple Calendar CLI wrapper via AppleScript
# Usage: calendar.sh <command> [args...]

CMD="$1"
shift

case "$CMD" in
  list-calendars)
    osascript -e 'tell application "Calendar" to get name of every calendar'
    ;;

  today)
    osascript -e '
      set today to current date
      set time of today to 0
      set tomorrow to today + (1 * days)
      tell application "Calendar"
        set output to ""
        repeat with cal in every calendar
          try
            set evts to (every event of cal whose start date >= today and start date < tomorrow)
            repeat with e in evts
              set startD to start date of e
              set endD to end date of e
              set timeStr to (time string of startD) & " - " & (time string of endD)
              set output to output & timeStr & " | " & (summary of e) & " [" & (name of cal) & "]" & linefeed
            end repeat
          end try
        end repeat
        return output
      end tell'
    ;;

  upcoming)
    DAYS="${1:-7}"
    osascript -e "
      set today to current date
      set time of today to 0
      set futureDate to today + ($DAYS * days)
      tell application \"Calendar\"
        set output to \"\"
        repeat with cal in every calendar
          try
            set evts to (every event of cal whose start date >= today and start date < futureDate)
            repeat with e in evts
              set startD to start date of e
              set endD to end date of e
              set dateStr to (short date string of startD) & \" \" & (time string of startD) & \" - \" & (time string of endD)
              set output to output & dateStr & \" | \" & (summary of e) & \" [\" & (name of cal) & \"]\" & linefeed
            end repeat
          end try
        end repeat
        return output
      end tell"
    ;;

  add)
    # Usage: calendar.sh add "Title" "2026-02-20 14:00" "2026-02-20 15:00" ["Calendar Name"]
    TITLE="$1"
    START="$2"
    END="$3"
    CAL_NAME="${4:-Calendar}"
    osascript -e "
      tell application \"Calendar\"
        tell calendar \"$CAL_NAME\"
          set newEvent to make new event with properties {summary:\"$TITLE\", start date:date \"$START\", end date:date \"$END\"}
          return \"Created: \" & summary of newEvent
        end tell
      end tell"
    ;;

  add-allday)
    # Usage: calendar.sh add-allday "Title" "2026-02-20" ["Calendar Name"]
    TITLE="$1"
    DATE="$2"
    CAL_NAME="${3:-Calendar}"
    osascript -e "
      tell application \"Calendar\"
        tell calendar \"$CAL_NAME\"
          set eventStart to date \"$DATE\"
          set time of eventStart to 0
          set eventEnd to eventStart + (1 * days)
          set newEvent to make new event with properties {summary:\"$TITLE\", start date:eventStart, end date:eventEnd, allday event:true}
          return \"Created all-day: \" & summary of newEvent
        end tell
      end tell"
    ;;

  search)
    # Usage: calendar.sh search "keyword"
    KEYWORD="$1"
    osascript -e "
      tell application \"Calendar\"
        set output to \"\"
        repeat with cal in every calendar
          try
            set evts to (every event of cal whose summary contains \"$KEYWORD\")
            repeat with e in evts
              set startD to start date of e
              set endD to end date of e
              set dateStr to (short date string of startD) & \" ~ \" & (short date string of endD)
              set output to output & dateStr & \" | \" & (summary of e) & \" [\" & (name of cal) & \"]\" & linefeed
            end repeat
          end try
        end repeat
        return output
      end tell"
    ;;

  delete)
    # Usage: calendar.sh delete "Event Title" "2026-02-20"
    TITLE="$1"
    DATE="$2"
    osascript -e "
      set targetDate to date \"$DATE\"
      set nextDay to targetDate + (1 * days)
      tell application \"Calendar\"
        repeat with cal in every calendar
          try
            set evts to (every event of cal whose summary is \"$TITLE\" and start date >= targetDate and start date < nextDay)
            repeat with e in evts
              delete e
            end repeat
          end try
        end repeat
        return \"Deleted events matching: $TITLE on $DATE\"
      end tell"
    ;;

  *)
    echo "Apple Calendar CLI"
    echo ""
    echo "Commands:"
    echo "  list-calendars           List all calendars"
    echo "  today                    Show today's events"
    echo "  upcoming [days]          Show upcoming events (default: 7 days)"
    echo "  add \"title\" \"start\" \"end\" [cal]  Add event"
    echo "  add-allday \"title\" \"date\" [cal]   Add all-day event"
    echo "  search \"keyword\"         Search events"
    echo "  delete \"title\" \"date\"    Delete event"
    ;;
esac
