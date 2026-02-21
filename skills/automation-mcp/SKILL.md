---
name: automation-mcp
description: Control macOS desktop via MCP (mouse, keyboard, screenshots, windows). Use when the user asks to click, type, take screenshots, control windows, scroll, drag, or automate desktop interactions. Triggers on keywords like "click", "screenshot", "screen", "window", "type", "keyboard", "mouse", "drag", "scroll", "클릭", "스크린샷", "화면", "윈도우", "마우스", "키보드", "드래그", "스크롤", "자동화".
---

# Automation MCP (Desktop Control)

macOS desktop automation via `ashwwwin/automation-mcp`. Mouse, keyboard, screenshots, window management.

## Environment

- **Repo**: `<AUTOMATION_MCP_ROOT>`
- **Runtime**: `bun` (or absolute bun path if needed)
- **Transport**: stdio
- **Command**: `bun run <AUTOMATION_MCP_ROOT>/index.ts --stdio`
- **Config**: `.mcp.json` (Claude Code), `~/.codex/config.toml` (Codex CLI)

## macOS Permissions Required

Grant in **System Settings > Privacy & Security** for bun/terminal:
- **Accessibility** (mouse/keyboard control)
- **Screen Recording** (screenshots)

## Tools (20 total)

### Mouse
| Tool | Description |
|------|-------------|
| `mouseClick` | Click at (x, y). Options: left/right/middle |
| `mouseDoubleClick` | Double-click at (x, y) |
| `mouseMove` | Move cursor to (x, y) |
| `mouseGetPosition` | Get current cursor position |
| `mouseScroll` | Scroll up/down/left/right. Default amount: 3 |
| `mouseDrag` | Drag from current position to (x, y) |
| `mouseButtonControl` | Press/release button without click |
| `mouseMovePath` | Animate along coordinate path |

### Keyboard
| Tool | Description |
|------|-------------|
| `type` | Type text or key combos. Use `text` for literal text, `keys` for combos (e.g. `LeftControl,C`) |
| `keyControl` | Press/release specific keys for advanced combos |
| `systemCommand` | Common shortcuts: copy, paste, cut, undo, redo, selectAll, save, quit, minimize, switchApp, newTab, closeTab |

### Screen
| Tool | Description |
|------|-------------|
| `screenshot` | Capture full screen, region, or window |
| `screenInfo` | Get screen dimensions |
| `screenHighlight` | Highlight a region visually |
| `colorAt` | Get pixel color at (x, y) |

### Windows
| Tool | Description |
|------|-------------|
| `getWindows` | List all open windows |
| `getActiveWindow` | Get active window info |
| `windowControl` | Focus, move, resize, minimize, restore |

### Utility
| Tool | Description |
|------|-------------|
| `waitForImage` | Wait for template image on screen (stub - not fully implemented) |
| `sleep` | Pause execution for N ms |

## Common Patterns

### Screenshot + Analyze
```
1. screenshot(mode: "full")  -> returns image
2. Analyze the image to find UI elements
3. mouseClick(x, y) on target
```

### Type Text into Field
```
1. mouseClick(x, y)  -> focus the field
2. type(text: "hello world")
```

### Key Combo
```
type(keys: "LeftControl,C")        # copy
type(keys: "LeftMeta,Space")       # spotlight
systemCommand(command: "paste")    # paste
```

### Window Management
```
1. getWindows()  -> find target window
2. windowControl(action: "focus", windowTitle: "Safari")
3. windowControl(action: "resize", width: 800, height: 600)
```

## Known Issues

- `waitForImage`: Stub only, no real template matching
- Escape key: nut.js enum value 0 causes false rejection
- bun path: If `bun` is not on PATH, use an absolute bun path for your machine
- macOS key names: Use `LeftMeta` for Cmd, `LeftControl` for Ctrl, `LeftAlt` for Option
