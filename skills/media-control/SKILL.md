---
name: media-control
description: Control macOS media playback (Apple Music, Spotify), system volume, and text-to-speech. Use when the user asks to play/pause/skip music, adjust volume, check what's playing, mute/unmute, search for songs, or use TTS. Triggers on keywords like "music", "play", "pause", "volume", "mute", "song", "track", "음악", "볼륨", "재생", "음소거", "노래", "say", "TTS", "Spotify".
---

# Media Control

Control macOS media playback and system audio via AppleScript.

## Auto-Detection

The skill auto-detects which music player is running:
- If **Spotify** is running → uses Spotify
- Otherwise → uses **Apple Music**

## Quick Reference

```bash
SKILL_DIR="<PROJECT_ROOT>/skills/media-control"

# Playback
bash "$SKILL_DIR/scripts/media.sh" play
bash "$SKILL_DIR/scripts/media.sh" pause
bash "$SKILL_DIR/scripts/media.sh" toggle
bash "$SKILL_DIR/scripts/media.sh" next
bash "$SKILL_DIR/scripts/media.sh" prev

# Now playing
bash "$SKILL_DIR/scripts/media.sh" now-playing

# Search & play (Music library search / Spotify URI)
bash "$SKILL_DIR/scripts/media.sh" search-play "Bohemian Rhapsody"

# Volume (0-100)
bash "$SKILL_DIR/scripts/media.sh" volume          # Get current
bash "$SKILL_DIR/scripts/media.sh" volume 50        # Set to 50
bash "$SKILL_DIR/scripts/media.sh" volume-up        # +10
bash "$SKILL_DIR/scripts/media.sh" volume-down      # -10
bash "$SKILL_DIR/scripts/media.sh" mute
bash "$SKILL_DIR/scripts/media.sh" unmute

# Playlists (Apple Music only)
bash "$SKILL_DIR/scripts/media.sh" playlists
bash "$SKILL_DIR/scripts/media.sh" play-playlist "My Playlist"

# Full status
bash "$SKILL_DIR/scripts/media.sh" status

# Text-to-Speech
bash "$SKILL_DIR/scripts/media.sh" say "Hello world"
bash "$SKILL_DIR/scripts/media.sh" say "안녕하세요" Yuna       # Korean voice
bash "$SKILL_DIR/scripts/media.sh" say-voices               # List voices
```

## TTS Voices

Common voices for Korean: `Yuna` (default). For English: `Samantha`, `Alex`, `Daniel`.
Use `say-voices` to list all available voices.

## Notes

- Spotify search opens Spotify app with search query (AppleScript limitation)
- Apple Music search-play searches the local library only
- Volume controls affect system-wide output volume
- Playback controls work even if the music app window is hidden
