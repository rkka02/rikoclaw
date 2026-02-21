---
name: trend-monitor
description: Monitors and aggregates trending topics from tech communities, news sites, and social platforms. Use when exploring current trends, checking what's hot in AI/tech/dev communities, doing heartbeat exploration, or when the user asks about trending topics, viral posts, or community sentiment. Combines agent-browser scraping with web search for comprehensive coverage. Triggers on keywords like "trend", "trending", "hot", "viral", "community", "reddit", "HN", "hacker news", "clien", "ruliweb", "트렌드", "핫", "커뮤니티".
---

# Trend Monitor

Systematic approach to monitoring tech communities and aggregating trends.

## Quick Start

For a full trend sweep, run sites in parallel using Task agents:

```
1. Launch parallel browser agents for each source category
2. Aggregate findings into structured report
3. Store notable findings in archival memory
```

## Source Categories

### Tier 1: AI/Tech (check every heartbeat)

| Source | URL | Method | Focus |
|--------|-----|--------|-------|
| Hacker News | `https://news.ycombinator.com/` | agent-browser | AI/LLM/agent/dev tools posts with >50pts |
| Techmeme | `https://www.techmeme.com/` | agent-browser | Top tech headlines |
| Reddit r/ClaudeAI | `https://old.reddit.com/r/ClaudeAI/hot/` | agent-browser or WebFetch | Claude ecosystem updates |
| Reddit r/LocalLLaMA | `https://old.reddit.com/r/LocalLLaMA/hot/` | agent-browser or WebFetch | Open-source model releases |

### Tier 2: General Tech (rotate)

| Source | URL | Method | Focus |
|--------|-----|--------|-------|
| Reddit r/artificial | `https://old.reddit.com/r/artificial/hot/` | agent-browser | AI industry news |
| Reddit r/programming | `https://old.reddit.com/r/programming/hot/` | agent-browser | Dev tools/practices |
| Product Hunt | `https://www.producthunt.com/` | agent-browser | New product launches |

### Tier 3: Korean Communities (rotate)

| Source | URL | Method | Notes |
|--------|-----|--------|-------|
| Clien | `https://www.clien.net/service/board/park` | agent-browser | Tech + general. Politics heavy |
| TheQoo | `https://theqoo.net/hot` | agent-browser | K-pop + viral + social issues |
| Ruliweb | `https://bbs.ruliweb.com/best/all` | agent-browser | Gaming + tech + humor |
| DCInside | `https://gall.dcinside.com/mgallery/board/lists/?id=singularity` | WebFetch only | Heavy anti-bot. Use WebFetch fallback |

### Tier 4: Market-Specific (when markets open)

For market sentiment (without dedicated stock MCP dependencies):

| Source | URL | Method |
|--------|-----|--------|
| Google Finance | `https://www.google.com/finance/` | agent-browser |
| Naver Finance | `https://finance.naver.com/sise/` | agent-browser |

## Browser Patterns

### Parallel Scraping (recommended)

Launch multiple Task agents with `run_in_background: true`, each browsing different sites. Collect results after all complete.

```
Task 1: HN + Techmeme (--session hn)
Task 2: Reddit AI subs (--session reddit)
Task 3: Korean communities (--session kr)
Task 4: Market sentiment data (--session market)
```

### Session Isolation

Always use `--session <name>` to avoid conflicts between parallel browsers:
```bash
agent-browser --session hn open "https://news.ycombinator.com/"
agent-browser --session hn snapshot
```

### Anti-Bot Sites

DCInside and some Korean sites block automated browsers. Fallback strategy:
1. Try agent-browser first
2. If blocked, use WebFetch with the URL
3. If WebFetch fails, use WebSearch for recent posts

### Data Extraction Pattern

```bash
# Open site
agent-browser --session <name> open "<url>"

# Get interactive elements (compact)
agent-browser --session <name> snapshot -i

# For full content extraction, use JS eval
agent-browser --session <name> eval "JSON.stringify(
  Array.from(document.querySelectorAll('selector'))
    .map(el => ({ title: el.textContent, url: el.href }))
)"

# Always close when done
agent-browser --session <name> close
```

## Report Format

Structure findings by significance:

```markdown
## [Category] Trends - [Date]

### Must-Know (urgent/high-impact)
- [Finding] - [Source](URL)

### Notable (interesting, worth tracking)
- [Finding] - [Source](URL)

### Signals (emerging patterns)
- [Theme]: [Evidence from multiple sources]
```

## Archival Memory Pattern

Store findings with consistent metadata:

```json
{
  "name": "[Topic] [Date] [Time]",
  "description": "<=100 chars summary",
  "detail": "Structured findings with URLs",
  "metadata": {
    "type": "trend|market|community",
    "topic": "ai_update|market_sentiment|korean_communities",
    "date": "YYYY-MM-DD",
    "time": "HH:mm"
  }
}
```

## Rotation Strategy

Not all sources need checking every heartbeat. Suggested rotation:

| Heartbeat | Sources |
|-----------|---------|
| Every time | HN, Techmeme, WebSearch for breaking AI news |
| Alternate | Reddit AI subs, Korean communities |
| When markets open | Market data + sentiment |
| Weekly deep-dive | Product Hunt, GitHub trending, academic papers |
