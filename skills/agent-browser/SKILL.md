---
name: agent-browser
description: |
  Token-efficient headless browser automation via `agent-browser` CLI. Use when web browsing, scraping, form interaction, or page inspection is needed and WebFetch is insufficient (e.g., JavaScript-rendered pages, interactive forms, multi-step navigation, login-required sites). Saves ~93% context vs Playwright MCP by using compact ref-based snapshots. Prefer this over WebFetch when: (1) the page requires JS rendering, (2) interaction is needed (click, fill, scroll), (3) multi-page navigation is required, (4) structured element data is needed from the DOM.
---

# Agent Browser

Headless browser automation CLI optimized for AI agents. Uses Chromium under the hood but returns compact, ref-based accessibility snapshots instead of raw DOM — drastically reducing token usage.

## Core Workflow

```
open URL → snapshot → interact via @refs → extract data → close
```

### 1. Open & Navigate

```bash
agent-browser open https://example.com        # Navigate to URL
agent-browser back                             # Go back
agent-browser forward                          # Go forward
agent-browser reload                           # Reload page
```

### 2. Snapshot (Key Feature)

```bash
agent-browser snapshot                         # Full accessibility tree with @refs
agent-browser snapshot -i                      # Interactive elements only (smaller)
```

Output example:
```
- heading "Example Domain" [ref=e1] [level=1]
- paragraph: Some text...
- link "More info" [ref=e2]
- textbox "Search" [ref=e3]
- button "Submit" [ref=e4]
```

Use `snapshot -i` first for most tasks — it shows only actionable elements and is much smaller.

### 3. Interact via Refs

```bash
agent-browser click @e2                        # Click element
agent-browser fill @e3 "search query"          # Clear + type into input
agent-browser type @e3 "append text"           # Append text (no clear)
agent-browser press Enter                      # Press key
agent-browser select @e5 "option-value"        # Select dropdown
agent-browser check @e6                        # Check checkbox
agent-browser hover @e7                        # Hover
agent-browser scroll down 500                  # Scroll down 500px
agent-browser scrollintoview @e8               # Scroll element into view
```

### 4. Extract Data

```bash
agent-browser get text @e1                     # Get text content
agent-browser get html @e1                     # Get HTML
agent-browser get value @e3                    # Get input value
agent-browser get title                        # Page title
agent-browser get url                          # Current URL
agent-browser get attr href @e2                # Get attribute
agent-browser get count "li"                   # Count elements
```

### 5. Screenshot & PDF

```bash
agent-browser screenshot                       # Viewport screenshot
agent-browser screenshot --full                # Full page screenshot
agent-browser screenshot /tmp/page.png         # Save to specific path
agent-browser pdf /tmp/page.pdf                # Save as PDF
```

### 6. Close

```bash
agent-browser close                            # Close browser
```

## Advanced Features

### Sessions (Isolated Contexts)

```bash
agent-browser --session task1 open site1.com   # Session "task1"
agent-browser --session task2 open site2.com   # Session "task2" (independent)
```

### Session State Persistence

```bash
agent-browser --session-name myapp open site.com  # Auto-saves cookies/localStorage
# Next time, state is restored automatically
```

### JavaScript Eval

```bash
agent-browser eval "document.title"
agent-browser eval "document.querySelectorAll('a').length"
```

### Wait

```bash
agent-browser wait 2000                        # Wait 2 seconds
agent-browser wait ".loading"                  # Wait for element to appear
```

### Network & Headers

```bash
agent-browser set headers '{"Authorization":"Bearer token123"}'
agent-browser set credentials user pass        # HTTP basic auth
agent-browser network requests                 # View captured requests
```

### Tabs

```bash
agent-browser tab list                         # List open tabs
agent-browser tab new                          # Open new tab
agent-browser tab 2                            # Switch to tab 2
agent-browser tab close                        # Close current tab
```

### Find Elements (Alternative to Refs)

```bash
agent-browser find role button click --name Submit
agent-browser find text "Log in" click
agent-browser find placeholder "Email" fill "user@test.com"
```

## Best Practices

1. **Always `snapshot -i` first** — interactive-only snapshots are compact and sufficient for most tasks
2. **Use refs (`@e1`)** — never CSS selectors; refs are stable within a page session
3. **Close when done** — `agent-browser close` frees resources
4. **Chain commands** — each command is stateful; the browser stays open between calls
5. **For long pages** — `scroll down` + `snapshot -i` to reveal more content
6. **For data extraction** — `snapshot` for structure, `get text` for specific elements
7. **Timeout awareness** — pages with slow JS may need `wait` before `snapshot`

## Command Reference

For the full command list, see [references/commands.md](references/commands.md).
