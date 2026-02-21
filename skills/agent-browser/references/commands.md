# Agent Browser Command Reference

## Core Commands

| Command | Description |
|---------|-------------|
| `open <url>` | Navigate to URL |
| `click <sel>` | Click element (or @ref) |
| `dblclick <sel>` | Double-click element |
| `type <sel> <text>` | Type into element (appends) |
| `fill <sel> <text>` | Clear and fill element |
| `press <key>` | Press key (Enter, Tab, Control+a) |
| `hover <sel>` | Hover element |
| `focus <sel>` | Focus element |
| `check <sel>` | Check checkbox |
| `uncheck <sel>` | Uncheck checkbox |
| `select <sel> <val...>` | Select dropdown option |
| `drag <src> <dst>` | Drag and drop |
| `upload <sel> <files...>` | Upload files |
| `download <sel> <path>` | Download file by clicking element |
| `scroll <dir> [px]` | Scroll (up/down/left/right) |
| `scrollintoview <sel>` | Scroll element into view |
| `wait <sel\|ms>` | Wait for element or time |
| `screenshot [path]` | Take screenshot (--full for full page) |
| `pdf <path>` | Save as PDF |
| `snapshot` | Accessibility tree with refs (-i for interactive only) |
| `eval <js>` | Run JavaScript |
| `connect <port\|url>` | Connect to browser via CDP |
| `close` | Close browser |

## Navigation

| Command | Description |
|---------|-------------|
| `back` | Go back |
| `forward` | Go forward |
| `reload` | Reload page |

## Get Info: `get <what> [selector]`

| Subcommand | Description |
|------------|-------------|
| `get text <sel>` | Get text content |
| `get html <sel>` | Get HTML content |
| `get value <sel>` | Get input value |
| `get attr <name> <sel>` | Get attribute value |
| `get title` | Page title |
| `get url` | Current URL |
| `get count <sel>` | Count matching elements |
| `get box <sel>` | Get bounding box |
| `get styles <sel>` | Get computed styles |

## Check State: `is <what> <selector>`

| Subcommand | Description |
|------------|-------------|
| `is visible <sel>` | Check if element is visible |
| `is enabled <sel>` | Check if element is enabled |
| `is checked <sel>` | Check if checkbox is checked |

## Find Elements: `find <locator> <value> <action> [text]`

| Locator | Description |
|---------|-------------|
| `find role <role> <action>` | Find by ARIA role |
| `find text <text> <action>` | Find by text content |
| `find label <label> <action>` | Find by label |
| `find placeholder <text> <action>` | Find by placeholder |
| `find alt <text> <action>` | Find by alt text |
| `find title <text> <action>` | Find by title |
| `find testid <id> <action>` | Find by test ID |
| `find first <sel> <action>` | First matching element |
| `find last <sel> <action>` | Last matching element |
| `find nth <sel> <n> <action>` | Nth matching element |

## Mouse: `mouse <action>`

| Subcommand | Description |
|------------|-------------|
| `mouse move <x> <y>` | Move mouse |
| `mouse down [btn]` | Mouse button down |
| `mouse up [btn]` | Mouse button up |
| `mouse wheel <dy> [dx]` | Mouse wheel scroll |

## Browser Settings: `set <setting>`

| Subcommand | Description |
|------------|-------------|
| `set viewport <w> <h>` | Set viewport size |
| `set device <name>` | Emulate device |
| `set geo <lat> <lng>` | Set geolocation |
| `set offline [on\|off]` | Toggle offline mode |
| `set headers <json>` | Set extra HTTP headers |
| `set credentials <user> <pass>` | Set HTTP basic auth |
| `set media [dark\|light]` | Set color scheme preference |

## Network: `network <action>`

| Subcommand | Description |
|------------|-------------|
| `network route <url> [--abort\|--body <json>]` | Intercept requests |
| `network unroute [url]` | Remove route |
| `network requests [--clear] [--filter <pattern>]` | View requests |

## Storage

| Command | Description |
|---------|-------------|
| `cookies [get\|set\|clear]` | Manage cookies |
| `storage <local\|session>` | Manage web storage |

## Tabs

| Command | Description |
|---------|-------------|
| `tab list` | List open tabs |
| `tab new` | Open new tab |
| `tab close` | Close current tab |
| `tab <n>` | Switch to tab n |

## Debug

| Command | Description |
|---------|-------------|
| `trace start\|stop [path]` | Record trace |
| `record start <path> [url]` | Start video recording |
| `record stop` | Stop recording |
| `console [--clear]` | View console logs |
| `errors [--clear]` | View page errors |
| `highlight <sel>` | Highlight element |

## Global Options

| Option | Description |
|--------|-------------|
| `--session <name>` | Use named session (isolated browser) |
| `--session-name <name>` | Auto-save/restore session state |
| `--full, -f` | Full page screenshot |
| `--headed` | Show browser window |
| `--cdp <port>` | Connect via CDP |
| `--auto-connect` | Auto-discover running Chrome |
| `--debug` | Debug output |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_BROWSER_SESSION` | Session name (default: "default") |
| `AGENT_BROWSER_SESSION_NAME` | State persistence name |
| `AGENT_BROWSER_ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM encryption |
| `AGENT_BROWSER_STATE_EXPIRE_DAYS` | Auto-delete states older than N days (default: 30) |
| `AGENT_BROWSER_EXECUTABLE_PATH` | Custom browser path |
