#!/bin/bash
# macOS Media Control CLI via AppleScript
# Supports: Apple Music, Spotify, System Volume
# Usage: media.sh <command> [args...]

CMD="$1"
shift

# Detect which music app is running
detect_player() {
  if osascript -e 'tell application "System Events" to (name of processes) contains "Spotify"' 2>/dev/null | grep -q "true"; then
    echo "Spotify"
  else
    echo "Music"
  fi
}

case "$CMD" in
  # === Playback Controls ===
  play)
    PLAYER=$(detect_player)
    osascript -e "tell application \"$PLAYER\" to play"
    echo "Playing ($PLAYER)"
    ;;

  pause)
    PLAYER=$(detect_player)
    osascript -e "tell application \"$PLAYER\" to pause"
    echo "Paused ($PLAYER)"
    ;;

  toggle)
    PLAYER=$(detect_player)
    osascript -e "tell application \"$PLAYER\" to playpause"
    echo "Toggled ($PLAYER)"
    ;;

  next)
    PLAYER=$(detect_player)
    osascript -e "tell application \"$PLAYER\" to next track"
    sleep 1
    bash "$0" now-playing
    ;;

  prev|previous)
    PLAYER=$(detect_player)
    if [ "$PLAYER" = "Spotify" ]; then
      osascript -e "tell application \"Spotify\" to previous track"
    else
      osascript -e "tell application \"Music\" to back track"
    fi
    sleep 1
    bash "$0" now-playing
    ;;

  # === Now Playing ===
  now-playing|np)
    PLAYER=$(detect_player)
    if [ "$PLAYER" = "Spotify" ]; then
      osascript <<'EOF'
        tell application "Spotify"
          if player state is playing or player state is paused then
            set trackName to name of current track
            set artistName to artist of current track
            set albumName to album of current track
            set trackDur to duration of current track / 1000
            set playerPos to player position
            set stateStr to player state as string
            return stateStr & " | " & trackName & " - " & artistName & " | " & albumName & " | " & (round playerPos) & "s / " & (round trackDur) & "s"
          else
            return "Not playing"
          end if
        end tell
EOF
    else
      osascript <<'EOF'
        tell application "Music"
          if player state is playing or player state is paused then
            set trackName to name of current track
            set artistName to artist of current track
            set albumName to album of current track
            set trackDur to duration of current track
            set playerPos to player position
            set stateStr to player state as string
            return stateStr & " | " & trackName & " - " & artistName & " | " & albumName & " | " & (round playerPos) & "s / " & (round trackDur) & "s"
          else
            return "Not playing"
          end if
        end tell
EOF
    fi
    ;;

  # === Search & Play ===
  search-play|sp)
    # Usage: media.sh search-play "song name or artist"
    QUERY="$1"
    PLAYER=$(detect_player)
    if [ "$PLAYER" = "Spotify" ]; then
      # Spotify doesn't have built-in search via AppleScript; open search URI
      ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")
      osascript -e "open location \"spotify:search:$ENCODED\""
      echo "Opened Spotify search for: $QUERY"
    else
      osascript <<EOF
        tell application "Music"
          set searchResults to search playlist "Library" for "$QUERY"
          if length of searchResults > 0 then
            play item 1 of searchResults
            set t to item 1 of searchResults
            return "Playing: " & (name of t) & " - " & (artist of t)
          else
            return "No results found for: $QUERY"
          end if
        end tell
EOF
    fi
    ;;

  # === Volume Controls ===
  volume|vol)
    # Usage: media.sh volume [0-100]
    if [ -n "$1" ]; then
      osascript -e "set volume output volume $1"
      echo "Volume set to $1"
    else
      osascript -e 'get output volume of (get volume settings)'
    fi
    ;;

  mute)
    osascript -e 'set volume output muted true'
    echo "Muted"
    ;;

  unmute)
    osascript -e 'set volume output muted false'
    echo "Unmuted"
    ;;

  volume-up|vu)
    CURRENT=$(osascript -e 'get output volume of (get volume settings)')
    NEW=$((CURRENT + 10))
    [ $NEW -gt 100 ] && NEW=100
    osascript -e "set volume output volume $NEW"
    echo "Volume: $NEW"
    ;;

  volume-down|vd)
    CURRENT=$(osascript -e 'get output volume of (get volume settings)')
    NEW=$((CURRENT - 10))
    [ $NEW -lt 0 ] && NEW=0
    osascript -e "set volume output volume $NEW"
    echo "Volume: $NEW"
    ;;

  # === Playlist ===
  playlists)
    PLAYER=$(detect_player)
    if [ "$PLAYER" = "Spotify" ]; then
      echo "Spotify playlists not available via AppleScript"
    else
      osascript -e 'tell application "Music" to get name of every user playlist'
    fi
    ;;

  play-playlist)
    # Usage: media.sh play-playlist "Playlist Name"
    NAME="$1"
    PLAYER=$(detect_player)
    if [ "$PLAYER" = "Spotify" ]; then
      echo "Use Spotify app to select playlist"
    else
      osascript -e "tell application \"Music\" to play playlist \"$NAME\""
      echo "Playing playlist: $NAME"
    fi
    ;;

  # === Status ===
  status)
    PLAYER=$(detect_player)
    echo "Player: $PLAYER"
    bash "$0" now-playing
    echo "Volume: $(osascript -e 'get output volume of (get volume settings)')"
    echo "Muted: $(osascript -e 'get output muted of (get volume settings)')"
    ;;

  # === Say (TTS) ===
  say)
    # Usage: media.sh say "text" [voice]
    TEXT="$1"
    VOICE="${2:-Yuna}"
    say -v "$VOICE" "$TEXT"
    echo "Said: $TEXT (voice: $VOICE)"
    ;;

  say-voices)
    say -v '?' 2>&1 | grep -E "^[A-Za-z]" | head -30
    ;;

  *)
    echo "macOS Media Control CLI"
    echo ""
    echo "Playback:"
    echo "  play / pause / toggle      Control playback"
    echo "  next / prev                Skip tracks"
    echo "  now-playing (np)           Current track info"
    echo "  search-play (sp) \"query\"   Search and play"
    echo ""
    echo "Volume:"
    echo "  volume [0-100]             Get/set volume"
    echo "  mute / unmute              Toggle mute"
    echo "  volume-up (vu)             +10 volume"
    echo "  volume-down (vd)           -10 volume"
    echo ""
    echo "Playlists:"
    echo "  playlists                  List playlists"
    echo "  play-playlist \"name\"       Play a playlist"
    echo ""
    echo "Other:"
    echo "  status                     Full status"
    echo "  say \"text\" [voice]         Text to speech (default: Yuna)"
    echo "  say-voices                 List available voices"
    ;;
esac
