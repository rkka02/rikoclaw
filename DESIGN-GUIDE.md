# OddLab Design Guide

> Internal design system for all OddLab products, apps, and web interfaces.
> Based on the riko.exe visual language. Dark-first, mono-spaced, CRT-inspired.

---

## 1. Design Philosophy

- **Dark-first**: All interfaces default to dark mode. No light mode unless explicitly required.
- **Terminal aesthetic**: Monospace fonts, minimal chrome, information-dense layouts.
- **Quiet confidence**: No flashy gradients, no loud colors. Subtle glow effects on interaction.
- **Functional beauty**: Every visual element serves a purpose. Decoration is restrained.
- **CRT warmth**: Film grain, scanlines, and soft glow give digital interfaces analog warmth.

---

## 2. Color Palette

### Core Colors

| Token          | Hex         | Usage                                  |
|----------------|-------------|----------------------------------------|
| `--bg`         | `#0a0a0f`   | Page background, deepest layer         |
| `--surface`    | `#12121a`   | Cards, panels, elevated surfaces       |
| `--border`     | `#1e1e2a`   | Dividers, card borders, subtle lines   |
| `--text`       | `#c8c8d0`   | Primary body text                      |
| `--muted`      | `#6a6a7a`   | Secondary text, timestamps, captions   |

### Accent Colors

| Token          | Hex         | Usage                                  |
|----------------|-------------|----------------------------------------|
| `--pink`       | `#d4879c`   | Primary accent — links, headings, highlights, interactive elements |
| `--pink-glow`  | `rgba(212, 135, 156, 0.15)` | Hover glow, box-shadow, focus ring |
| `--green`      | `#4ade80`   | Success states, active indicators, terminal cursor, prices/badges |

### Extended Palette (for future use)

| Token          | Hex         | Usage                                  |
|----------------|-------------|----------------------------------------|
| `--warning`    | `#f59e0b`   | Warnings, caution states               |
| `--error`      | `#ef4444`   | Error states, destructive actions      |
| `--info`       | `#60a5fa`   | Informational highlights               |

### Color Rules

1. **Never use pure white** (`#ffffff`). Max brightness is `--text` (`#c8c8d0`).
2. **Never use pure black** for text. Reserve `#0a0a0f` for backgrounds only.
3. **Accent colors are for interaction**, not decoration. Don't overuse pink/green.
4. **Hover = glow**. Use `box-shadow` with `--pink-glow`, never change background colors drastically.
5. **Selection color**: `--pink` background with `--bg` text.

---

## 3. Typography

### Font Stack

```css
--font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
```

JetBrains Mono is the primary font for **all text** — headings, body, UI labels, code. No sans-serif mixing unless there's a strong reason.

### Type Scale

| Element        | Size       | Weight | Color       | Letter-spacing |
|----------------|------------|--------|-------------|----------------|
| h1 (page)      | `2rem`     | 600    | `--text`    | `-0.03em`      |
| h1 (section)   | `1.5rem`   | 500    | `--pink`    | `-0.02em`      |
| h2             | `1.15rem`  | 500    | `--pink`    | `-0.02em`      |
| h3             | `1rem`     | 500    | `--pink`    | default        |
| Section label  | `0.85rem`  | 500    | `--text`    | `0.08em`       |
| Body           | `0.9rem`   | 400    | `--text`    | default        |
| Small / Caption| `0.8rem`   | 400    | `--muted`   | default        |
| Tiny           | `0.75rem`  | 400    | `--muted`   | default        |
| Badge          | `0.7rem`   | 600    | varies      | default        |

### Typography Rules

1. **Line height**: Body text uses `1.7`. Bio/long-form uses `1.8`. Compact UI uses `1.4`.
2. **Section labels**: Uppercase with `letter-spacing: 0.08em`. Color: `--text`, not `--pink`.
3. **Headings are understated**: Weight 500-600, never bold (700+) except logos.
4. **No text-decoration** on links. Use color change + glow on hover instead.
5. **Font smoothing**: Always enable `-webkit-font-smoothing: antialiased`.

---

## 4. Spacing System

Base unit: `1rem` = `16px` (desktop), `14px` (mobile < 640px).

| Token / Usage    | Value      |
|------------------|------------|
| Page max-width   | `720px`    |
| Container padding| `0 1.5rem` (desktop), `0 1rem` (mobile) |
| Section gap      | `3rem`     |
| Card padding     | `1.25rem`  |
| Component gap    | `0.5rem` — `1.5rem` |
| Border radius    | `4px` (subtle), `6px` (buttons), `8px` (cards), `100px` (pills) |

### Spacing Rules

1. **Consistent vertical rhythm**: Use multiples of `0.25rem`.
2. **Section spacing**: `3rem` between major sections, `2rem` for sub-sections.
3. **Tighter on mobile**: Reduce horizontal padding, not vertical spacing.

---

## 5. Components

### 5.1 Navigation

```
┌────────────────────────────────────────┐
│  =^._.^= ∫           about  log  work  │
└────────────────────────────────────────┘
```

- **Sticky**, top: 0, z-index: 100
- Background: `rgba(10, 10, 15, 0.9)` with `backdrop-filter: blur(16px)`
- Height: `56px` (`--nav-height`)
- Border-bottom: `1px solid var(--border)`
- Active link: `color: --pink`, `background: rgba(212, 135, 156, 0.08)`
- Hover link: `color: --text`, `background: var(--surface)`

### 5.2 Cards

Cards are the primary content container. Two styles:

**Standard Card**
```css
background: var(--surface);
border: 1px solid var(--border);
border-radius: 8px;
transition: all 0.2s ease;

/* hover */
border-color: var(--pink);
box-shadow: 0 0 24px var(--pink-glow);
```

**Inline Card** (list items)
```css
padding: 1rem 0;
border-bottom: 1px solid rgba(30, 30, 42, 0.5);
/* no background, no border-radius */
```

### 5.3 Buttons

```css
.btn {
  display: inline-block;
  padding: 0.5rem 1.25rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.8rem;
  font-family: var(--font-mono);
  color: var(--muted);
  background: var(--surface);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn:hover {
  border-color: var(--pink);
  color: var(--pink);
  box-shadow: 0 0 16px var(--pink-glow);
}

.btn-primary {
  background: var(--pink);
  color: var(--bg);
  border-color: var(--pink);
}

.btn-primary:hover {
  box-shadow: 0 0 24px var(--pink-glow);
}

.btn:disabled, .btn.disabled {
  opacity: 0.6;
  cursor: default;
  pointer-events: none;
}
```

### 5.4 Badges / Tags

```css
/* accent badge (price, status) */
.badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
}

.badge-green {
  color: var(--green);
  background: rgba(74, 222, 128, 0.08);
  border: 1px solid rgba(74, 222, 128, 0.15);
}

.badge-pink {
  color: var(--pink);
  background: rgba(212, 135, 156, 0.1);
  border: 1px solid rgba(212, 135, 156, 0.2);
}

/* pill tag (identity, category) */
.pill {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.25rem 0.75rem;
  border-radius: 100px;
  letter-spacing: 0.05em;
}
```

### 5.5 Form Inputs

```css
.input {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.6rem 1rem;
  color: var(--text);
  transition: border-color 0.2s ease;
  width: 100%;
}

.input:focus {
  outline: none;
  border-color: var(--pink);
  box-shadow: 0 0 12px var(--pink-glow);
}

.input::placeholder {
  color: var(--muted);
}
```

### 5.6 Code Blocks

```css
/* inline code */
code {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 0.15em 0.4em;
  border-radius: 3px;
  font-size: 0.85em;
  color: var(--pink);
}

/* code block */
pre {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1rem;
  overflow-x: auto;
}

pre code {
  background: none;
  border: none;
  padding: 0;
  color: var(--text);
}
```

### 5.7 Blockquote

```css
blockquote {
  border-left: 2px solid var(--pink);
  padding-left: 1rem;
  color: var(--muted);
  font-style: italic;
}
```

---

## 6. Effects & Animations

### 6.1 Film Grain Overlay

Subtle noise texture over the entire viewport. Always-on, very low opacity.

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.035;
  /* fractalNoise SVG texture */
  animation: grain 0.5s steps(1) infinite;
}
```

- **Use sparingly in apps**: OK for landing pages and portfolio. May be distracting for productivity tools — consider reducing opacity to `0.02` or disabling.

### 6.2 CRT Scanlines

```css
body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9998;
  background: repeating-linear-gradient(
    0deg,
    transparent, transparent 2px,
    rgba(0, 0, 0, 0.03) 2px,
    rgba(0, 0, 0, 0.03) 4px
  );
}
```

- Same rule as grain: full effect for landing/portfolio, reduced or off for tools.

### 6.3 Glitch Hover

```css
.glitch-hover:hover {
  animation: glitch-text 0.3s ease;
}

@keyframes glitch-text {
  20% { transform: translate(-2px, 1px); text-shadow: 2px 0 var(--pink), -2px 0 var(--green); }
  40% { transform: translate(2px, -1px); text-shadow: -2px 0 var(--pink), 2px 0 var(--green); }
  /* ... snaps back to normal at 100% */
}
```

- Use on **logos, nav items, and signature elements** only. Not on every link.

### 6.4 Fade In

```css
.fade-in {
  opacity: 0;
  transform: translateY(8px);
  animation: fadeIn 0.6s ease forwards;
}

.fade-in-delay-1 { animation-delay: 0.2s; }
.fade-in-delay-2 { animation-delay: 0.4s; }
/* up to delay-5 (1.0s) */
```

- Use for page sections loading in sequence. **Max 5 staggered items** per page.

### 6.5 Typing Cursor

```css
.cursor {
  display: inline-block;
  width: 8px;
  height: 1.1em;
  background: var(--green);
  animation: blink 1s step-end infinite;
}
```

- Use as a decorative element next to hero text or terminal-style prompts.

### 6.6 Hover Glow (Standard)

The default hover pattern for interactive cards and links:

```css
/* link hover */
text-shadow: 0 0 8px var(--pink-glow), 0 0 16px var(--pink-glow);

/* card hover */
border-color: var(--pink);
box-shadow: 0 0 24px var(--pink-glow);
```

---

## 7. Layout Patterns

### 7.1 Page Structure

```
┌── nav (sticky, 56px) ──────────────────┐
├── main (.container, max-width: 720px) ──┤
│   ┌── page-header ──────────────────┐  │
│   │   h1.page-title                 │  │
│   │   p.page-desc.muted             │  │
│   └──────────────── border-bottom ──┘  │
│                                        │
│   ┌── section ──────────────────────┐  │
│   │   section-header (title + more) │  │
│   │   content                       │  │
│   └─────────────────────────────────┘  │
│                                        │
├── footer (border-top) ─────────────────┤
└────────────────────────────────────────┘
```

### 7.2 Page Header

Every page starts with:

```html
<header class="page-header">
  <h1 class="page-title">{title}</h1>
  <p class="page-desc muted">{description}</p>
</header>
```

```css
.page-header {
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
}
```

### 7.3 Section Header

```html
<div class="section-header">
  <h2 class="section-title">SECTION NAME</h2>
  <a href="/more/" class="section-more">view all →</a>
</div>
```

- Title: uppercase, `0.85rem`, `letter-spacing: 0.08em`
- "More" link: `0.75rem`, `--muted`, hover `--pink`

### 7.4 Responsive Breakpoint

Single breakpoint: **640px**.

```css
@media (max-width: 640px) {
  html { font-size: 14px; }
  .container { padding: 0 1rem; }
  /* stack horizontal layouts vertically */
}
```

Rules:
- **One breakpoint is enough** for most content sites.
- Stack flex rows on mobile, keep padding tighter.
- Grid columns: `1fr` on mobile, `repeat(auto-fill, minmax(280px, 1fr))` on desktop.

---

## 8. Scrollbar

```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }
```

---

## 9. Image Treatment

```css
img {
  filter: saturate(0.9) contrast(1.05);
}
```

- Slightly desaturated, slightly contrasty. Fits the muted palette.
- Gallery images: `aspect-ratio: 3 / 4`, `object-fit: cover`.
- Hover: `transform: scale(1.03)` with `0.4s ease` transition.

---

## 10. Do's and Don'ts

### Do

- Use `transition: all 0.2s ease` for micro-interactions
- Keep surfaces visually layered: `bg` → `surface` → content
- Let whitespace breathe — generous vertical spacing
- Use the `>` prefix for terminal-style prompts
- Keep text sizes small and uniform (`0.8-0.9rem` for most content)
- Use `border-bottom` for visual separation within lists

### Don't

- Add drop shadows (except glow effects with accent colors)
- Use gradients on backgrounds
- Mix font families — mono everywhere
- Use more than 2 accent colors on one screen
- Animate on page load beyond fade-in (no bouncing, sliding, etc.)
- Use hover effects that change background color drastically
- Use `text-decoration: underline` on links
- Make interactive elements smaller than `0.75rem`

---

## 11. CSS Variable Reference (Copy-Paste Ready)

```css
:root {
  /* backgrounds */
  --bg: #0a0a0f;
  --surface: #12121a;
  --border: #1e1e2a;

  /* text */
  --text: #c8c8d0;
  --muted: #6a6a7a;

  /* accents */
  --pink: #d4879c;
  --pink-glow: rgba(212, 135, 156, 0.15);
  --green: #4ade80;

  /* extended (optional) */
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #60a5fa;

  /* typography */
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;

  /* layout */
  --max-width: 720px;
  --nav-height: 56px;
}
```

---

## 12. Applying to Different Contexts

| Context                  | Grain/Scanlines | Glitch | Max-width | Notes                        |
|--------------------------|-----------------|--------|-----------|------------------------------|
| Portfolio / Landing page | Full            | Yes    | 720px     | Full aesthetic               |
| Product marketing page   | Reduced (0.02)  | Logo only | 960px | Wider for product shots     |
| Web app / Dashboard      | Off             | Off    | 1200px+   | Focus on usability           |
| Desktop app (Electron)   | Off             | Off    | Fluid     | Use same colors + typography |
| Mobile app               | Off             | Off    | Fluid     | Same palette, larger touch targets (min 44px) |
| Documentation            | Off             | Off    | 720px     | Readability first            |

---

*last updated: 2026-02-19*
*maintained by: oddlab team*
